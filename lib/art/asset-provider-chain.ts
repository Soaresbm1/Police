import { generatedAssetProvider as defaultGeneratedAssetProvider, type GeneratedAssetProvider } from "./generated-asset-provider";
import type { GeneratedAssetKind } from "./generation/types";

/**
 * A one-shot, non-persisted resolve: try the generated-asset backend first
 * (the default, always-null implementation unless a real one is
 * injected), fall back to the procedural renderer on `null` or on any
 * failure. Art must never prevent gameplay — a broken or unavailable
 * generator silently degrades to procedural art rather than surfacing an
 * error. `provider` is injectable (defaulting to the real singleton) so
 * this can be tested without touching module state.
 *
 * For anything that should be generated once and reused forever (the
 * normal case for case artwork), use `lib/art/generation/pipeline.ts`
 * instead — that layer adds the persistent cache/state-machine this
 * function deliberately does not have.
 */
export async function resolveAsset(
  kind: GeneratedAssetKind,
  prompt: string,
  seed: string,
  procedural: () => string,
  provider: GeneratedAssetProvider = defaultGeneratedAssetProvider,
): Promise<string> {
  try {
    const generated = await provider.generate(kind, prompt, seed);
    if (generated) {
      const base64 = Buffer.from(generated.bytes).toString("base64");
      return `data:${generated.contentType};base64,${base64}`;
    }
  } catch {
    // Fall through to the procedural renderer — art failures are never fatal.
  }
  return procedural();
}
