import type { GeneratedAssetKind } from "./generation/types";

/**
 * The seam a real image-generation backend plugs into later. Nothing in
 * this file calls an external service, holds an API key, or depends on a
 * specific vendor — the default implementation always declines, which
 * tells every caller (via `pipeline.ts`/`resolveAsset` in
 * `asset-provider-chain.ts`) to fall back to the procedural renderer.
 * Swapping `generatedAssetProvider` for a real backend is the only change
 * needed anywhere in the app.
 *
 * Providers receive a finished prompt string, never the raw visual
 * descriptor — prompt construction is our own, testable, versioned code
 * (`lib/art/generation/character-prompt.ts` etc.), not the provider's
 * concern. This keeps every provider implementation dumb/interchangeable:
 * an OpenAI-backed provider and a self-hosted-model provider both just
 * take a string and return image bytes.
 */
export interface GeneratedAssetResult {
  bytes: Uint8Array;
  contentType: string;
  width: number;
  height: number;
  /** The provider's own model/version identifier, stored alongside the
   * asset for reproducibility/debugging — never invented by our code. */
  model: string;
}

export interface GeneratedAssetProvider {
  /**
   * Attempts to produce a real generated asset for the given prompt.
   * Returns `null` when unavailable — should not throw for ordinary
   * failures (rate limits, timeouts, content policy) so callers can
   * always fall back safely; `pipeline.ts` treats a thrown error the same
   * as a `null` result regardless.
   */
  generate(kind: GeneratedAssetKind, prompt: string, seed: string): Promise<GeneratedAssetResult | null>;
}

export class NullGeneratedAssetProvider implements GeneratedAssetProvider {
  async generate(): Promise<GeneratedAssetResult | null> {
    return null;
  }
}

export const generatedAssetProvider: GeneratedAssetProvider = new NullGeneratedAssetProvider();
