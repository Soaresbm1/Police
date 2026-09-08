import type { GeneratedAssetProvider } from "../generated-asset-provider";
import type { AssetStatus, GeneratedAssetKind, GeneratedAssetRecord } from "./types";
import { FAILURE_COOLDOWN_MINUTES, GENERATION_TIMEOUT_MS, MAX_ASSETS_PER_CASE, MAX_GENERATION_ATTEMPTS } from "./limits";

/**
 * The store contract `pipeline.ts` needs — structurally satisfied by the
 * real Supabase-backed functions in `asset-store.ts` (imported together as
 * a namespace) and by a fake in-memory implementation in tests, so this
 * orchestration logic never needs a live Supabase instance to verify.
 */
export interface AssetStoreLike {
  findAssetRecord(userId: string, descriptorHash: string, generationVersion: number, provider: string): Promise<GeneratedAssetRecord | null>;
  createQueuedRecord(
    userId: string,
    caseSeed: string,
    assetKind: GeneratedAssetKind,
    descriptorHash: string,
    generationVersion: number,
    provider: string,
  ): Promise<GeneratedAssetRecord>;
  markGenerating(userId: string, id: string): Promise<void>;
  markReady(
    userId: string,
    id: string,
    fields: { storagePath: string; width: number; height: number; providerModel: string; promptVersion: number },
  ): Promise<void>;
  markFailed(userId: string, id: string, errorMessage: string, attemptCount: number): Promise<void>;
  countAssetsForCase(userId: string, caseSeed: string): Promise<number>;
  uploadAssetBytes(userId: string, caseSeed: string, descriptorHash: string, bytes: Uint8Array, contentType: string): Promise<{ path: string }>;
  getSignedAssetUrl(path: string, expiresInSeconds?: number): Promise<string | null>;
}

export interface GetOrGenerateAssetArgs {
  userId: string;
  caseSeed: string;
  assetKind: GeneratedAssetKind;
  descriptorHash: string;
  generationVersion: number;
  /** Identifies which provider produced/would produce this asset — part
   * of the "generate once" uniqueness key alongside descriptor+version, so
   * switching providers never collides with a prior provider's asset. */
  providerName: string;
  promptVersion: number;
  prompt: string;
  /** Passed through to `provider.generate()` as its own seed — usually
   * the same seed the visual descriptor itself was built from. */
  seed: string;
}

export interface GetOrGenerateAssetResult {
  status: AssetStatus;
  url: string | null;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`generation timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

const MISSING: GetOrGenerateAssetResult = { status: "missing", url: null };
const FAILED: GetOrGenerateAssetResult = { status: "failed", url: null };

/**
 * The full `CaseSeed → ... → permanent asset URL` flow (see
 * GENERATED_ART.md). Never throws — any unexpected failure (a Supabase
 * outage, a provider error, a timeout) resolves to `{ status: "failed" |
 * "missing", url: null }` so the caller's existing procedural renderer can
 * take over unconditionally. Never called from React rendering — intended
 * to be invoked from a Server Action/Route Handler ahead of a page that
 * wants to display generated art, with the result (or lack of one) passed
 * down as a plain prop.
 */
export async function getOrGenerateAsset(
  deps: { store: AssetStoreLike; provider: GeneratedAssetProvider },
  args: GetOrGenerateAssetArgs,
): Promise<GetOrGenerateAssetResult> {
  const { store, provider } = deps;

  try {
    const existing = await store.findAssetRecord(args.userId, args.descriptorHash, args.generationVersion, args.providerName);

    if (existing?.status === "ready" && existing.storagePath) {
      const url = await store.getSignedAssetUrl(existing.storagePath);
      return { status: "ready", url };
    }
    if (existing?.status === "queued" || existing?.status === "generating") {
      // Another request is already handling this exact asset — never pile
      // on a second concurrent generation for the same descriptor.
      return { status: existing.status, url: null };
    }
    if (existing?.status === "failed") {
      const cooledDown = !existing.failedAt || Date.now() - new Date(existing.failedAt).getTime() > FAILURE_COOLDOWN_MINUTES * 60_000;
      const attemptsLeft = existing.attemptCount < MAX_GENERATION_ATTEMPTS;
      if (!cooledDown || !attemptsLeft) return FAILED;
    }

    let record = existing;
    if (!record) {
      const currentCount = await store.countAssetsForCase(args.userId, args.caseSeed);
      if (currentCount >= MAX_ASSETS_PER_CASE) return MISSING; // pilot cap reached — stay procedural
      record = await store.createQueuedRecord(args.userId, args.caseSeed, args.assetKind, args.descriptorHash, args.generationVersion, args.providerName);
    }

    await store.markGenerating(args.userId, record.id);

    let generated;
    try {
      generated = await withTimeout(provider.generate(args.assetKind, args.prompt, args.seed), GENERATION_TIMEOUT_MS);
    } catch {
      generated = null;
    }

    if (!generated) {
      await store.markFailed(args.userId, record.id, "provider returned no result", record.attemptCount + 1);
      return FAILED;
    }

    const { path } = await store.uploadAssetBytes(args.userId, args.caseSeed, args.descriptorHash, generated.bytes, generated.contentType);
    await store.markReady(args.userId, record.id, {
      storagePath: path,
      width: generated.width,
      height: generated.height,
      providerModel: generated.model,
      promptVersion: args.promptVersion,
    });
    const url = await store.getSignedAssetUrl(path);
    return { status: "ready", url };
  } catch {
    // A store-layer failure (network, RLS misconfiguration, etc.) is exactly
    // as recoverable as a provider failure from the caller's point of view.
    return FAILED;
  }
}
