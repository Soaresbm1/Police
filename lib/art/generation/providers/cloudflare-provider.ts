import type { GeneratedAssetProvider, GeneratedAssetResult } from "../../generated-asset-provider";
import type { GeneratedAssetKind } from "../types";
import { hashSeed } from "../../hash";

/**
 * `GeneratedAssetProvider` adapter for Cloudflare Workers AI's
 * `@cf/black-forest-labs/flux-1-schnell` model, called via the plain REST
 * API (this is a Next.js app, not a Cloudflare Worker, so there is no
 * `env.AI` binding available — every call is a normal authenticated HTTP
 * request from our own server). This is the ONLY file in CASELINE that
 * knows Cloudflare exists; every caller only ever sees the neutral
 * `GeneratedAssetProvider` interface (`generate(kind, prompt, seed)`), so
 * swapping providers later needs no change anywhere else.
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

/** Documented output size for this model's REST endpoint: the input
 * schema exposes no width/height/size parameter, so resolution isn't
 * configurable — 1024x1024 is FLUX.1 [schnell]'s native default output.
 * Not yet cross-checked against a real response (there hasn't been one);
 * flag this in the pilot report rather than assume it's exact. */
const OUTPUT_WIDTH = 1024;
const OUTPUT_HEIGHT = 1024;

/** Cloudflare's `seed` parameter wants a positive integer; CASELINE's
 * visual-descriptor seeds are strings. Deterministic either way — the
 * same descriptor seed always maps to the same numeric seed. */
function seedToPositiveInt(seed: string): number {
  return hashSeed(seed) % 2_147_483_647;
}

interface CloudflareRunResponse {
  result?: { image?: string };
  image?: string;
  success?: boolean;
  errors?: { message: string }[];
}

export class CloudflareGeneratedAssetProvider implements GeneratedAssetProvider {
  async generate(kind: GeneratedAssetKind, prompt: string, seed: string): Promise<GeneratedAssetResult | null> {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;
    if (!accountId || !apiToken) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(`${CLOUDFLARE_API_BASE}/${accountId}/ai/run/${CLOUDFLARE_MODEL}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt,
          seed: seedToPositiveInt(seed),
          steps: resolveSteps(),
        }),
        signal: controller.signal,
      });

      if (response.status === 429) {
        console.warn(`[CASELINE] Cloudflare Workers AI rate-limited a "${kind}" generation request.`);
        return null;
      }
      if (!response.ok) {
        console.warn(`[CASELINE] Cloudflare Workers AI request failed: HTTP ${response.status}`);
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

      return {
        bytes,
        contentType: "image/jpeg",
        width: OUTPUT_WIDTH,
        height: OUTPUT_HEIGHT,
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
