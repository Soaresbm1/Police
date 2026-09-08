import type { GeneratedAssetProvider, GeneratedAssetResult } from "../../generated-asset-provider";
import type { GeneratedAssetKind } from "../types";
import { readJpegDimensions } from "../jpeg-dimensions";

/**
 * `GeneratedAssetProvider` adapter for Cloudflare Workers AI's
 * `@cf/black-forest-labs/flux-1-schnell` model, called via the plain REST
 * API (this is a Next.js app, not a Cloudflare Worker, so there is no
 * `env.AI` binding available — every call is a normal authenticated HTTP
 * request from our own server). This is the ONLY file in CASELINE that
 * knows Cloudflare exists; every caller only ever sees the neutral
 * `GeneratedAssetProvider` interface (`generate(kind, prompt, seed)`), so
 * swapping providers later needs no change anywhere else.
 *
 * NOTE: several publicly documented examples for this model (including
 * Cloudflare's own docs site, confirmed via research before writing this
 * file) show a `seed` request parameter for reproducibility. The LIVE API
 * rejected it during the real pilot run with `"Additional or unevaluated
 * properties '/seed' at '/' not allowed"` (error code 5006) — so `seed`
 * is deliberately NOT sent here, overriding the originally-planned design.
 * CASELINE's own descriptor-hash-based caching (see `pipeline.ts`) is what
 * actually provides determinism/reuse — Cloudflare-side seeding was never
 * load-bearing for that guarantee, only a would-be quality nicety.
 */
const CLOUDFLARE_MODEL = "@cf/black-forest-labs/flux-1-schnell";
const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4/accounts";
const REQUEST_TIMEOUT_MS = 20_000;

// FLUX.1 [schnell]'s documented input schema accepts 1-8 diffusion steps
// (Cloudflare's own default is 4). Configurable via env so quality can be
// compared later without touching the provider's code — kept
// conservative by default since more steps costs more neurons for
// marginal quality gain at pilot scale.
const MIN_STEPS = 1;
const MAX_STEPS = 8;
const DEFAULT_STEPS = 4;

function resolveSteps(): number {
  const raw = process.env.IMAGE_GENERATION_STEPS;
  const parsed = raw ? Number.parseInt(raw, 10) : DEFAULT_STEPS;
  if (!Number.isFinite(parsed)) return DEFAULT_STEPS;
  return Math.min(MAX_STEPS, Math.max(MIN_STEPS, parsed));
}

/** True only when both Cloudflare env vars are present — the sole gate
 * deciding whether `active-provider.ts` registers this implementation at
 * all. Missing/partial config never crashes CASELINE; it just means the
 * app never leaves the procedural fallback. */
export function isCloudflareConfigured(): boolean {
  return Boolean(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN);
}

/** Fallback only — used solely if the real JPEG bytes can't be parsed
 * (`readJpegDimensions` returns `null`, which shouldn't happen for a
 * well-formed response but must still degrade safely). The model's
 * documented input schema exposes no width/height/size parameter, so
 * this can't be asserted as configurable; real dimensions are read
 * directly from the returned bytes below instead of assumed. */
const FALLBACK_WIDTH = 1024;
const FALLBACK_HEIGHT = 1024;

interface CloudflareRunResponse {
  result?: { image?: string };
  image?: string;
  success?: boolean;
  errors?: { message: string }[];
}

export class CloudflareGeneratedAssetProvider implements GeneratedAssetProvider {
  // `seed` is part of the shared `GeneratedAssetProvider` contract (every
  // implementation receives one) but this model's live API rejects a
  // `seed` request field — see the class doc comment above. Determinism
  // still comes from CASELINE's own descriptor-hash cache, not from this
  // provider re-deriving the same image bit-for-bit.
  async generate(kind: GeneratedAssetKind, prompt: string, seed: string): Promise<GeneratedAssetResult | null> {
    void seed; // required by the shared interface, unused — see comment above
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;
    if (!accountId || !apiToken) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const startedAt = Date.now();

    try {
      const response = await fetch(`${CLOUDFLARE_API_BASE}/${accountId}/ai/run/${CLOUDFLARE_MODEL}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt,
          steps: resolveSteps(),
        }),
        signal: controller.signal,
      });

      if (response.status === 429) {
        console.warn(`[CASELINE] Cloudflare Workers AI rate-limited a "${kind}" generation request.`);
        return null;
      }
      if (!response.ok) {
        // The response body here is Cloudflare's own error payload (never
        // our prompt or credentials) — safe and useful to log verbatim
        // while diagnosing pilot failures.
        const bodyText = await response.text().catch(() => "");
        console.warn(`[CASELINE] Cloudflare Workers AI request failed: HTTP ${response.status} — ${bodyText.slice(0, 500)}`);
        return null;
      }

      const contentType = response.headers.get("content-type") ?? "";
      let bytes: Uint8Array;

      if (contentType.includes("application/json")) {
        const json = (await response.json()) as CloudflareRunResponse;
        if (json.success === false) {
          console.warn(`[CASELINE] Cloudflare Workers AI rejected the request: ${json.errors?.[0]?.message ?? "unknown error"}`);
          return null;
        }
        const base64 = json.result?.image ?? json.image;
        if (!base64) {
          console.warn("[CASELINE] Cloudflare Workers AI response had no image field.");
          return null;
        }
        bytes = Buffer.from(base64, "base64");
      } else if (contentType.startsWith("image/")) {
        // Some Workers AI image endpoints return raw bytes directly
        // instead of a JSON envelope depending on content negotiation —
        // the documented examples for this specific model are
        // inconsistent about which, so both are handled.
        bytes = new Uint8Array(await response.arrayBuffer());
      } else {
        console.warn(`[CASELINE] Cloudflare Workers AI returned an unexpected content-type: "${contentType}"`);
        return null;
      }

      if (bytes.byteLength === 0) return null;

      const dimensions = readJpegDimensions(bytes);
      if (!dimensions) {
        console.warn("[CASELINE] Cloudflare Workers AI response bytes did not parse as a valid JPEG header — using fallback dimensions.");
      }

      const elapsedMs = Date.now() - startedAt;
      console.log(
        `[CASELINE] Cloudflare Workers AI generated a "${kind}" asset in ${elapsedMs}ms ` +
          `(model=${CLOUDFLARE_MODEL}, bytes=${bytes.byteLength}, dimensions=${dimensions ? `${dimensions.width}x${dimensions.height}` : "unknown"}, content-type=${contentType || "unknown"}).`,
      );

      return {
        bytes,
        contentType: "image/jpeg",
        width: dimensions?.width ?? FALLBACK_WIDTH,
        height: dimensions?.height ?? FALLBACK_HEIGHT,
        model: CLOUDFLARE_MODEL,
      };
    } catch (err) {
      // Timeouts (AbortError), network failures, and malformed-JSON
      // parse errors all land here — never thrown further up. Logs the
      // failure reason only, never the prompt or any credential.
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`[CASELINE] Cloudflare Workers AI generation failed (${kind}): ${reason}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
