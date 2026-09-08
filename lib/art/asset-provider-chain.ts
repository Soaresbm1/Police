import { generatedAssetProvider as defaultGeneratedAssetProvider, type GeneratedAssetProvider } from "./generated-asset-provider";

/**
 * The one wiring pattern every art consumer uses: try the generated-asset
 * backend first (the default, always-null implementation unless a real one
 * is injected), fall back to the procedural renderer on `null` or on any
 * failure. Art must never prevent gameplay — a broken or unavailable
 * generator silently degrades to procedural art rather than surfacing an
 * error. `provider` is injectable (defaulting to the real singleton) so
 * this can be tested without touching module state.
 */
export async function resolveAsset(
  kind: string,
  descriptor: unknown,
  seed: string,
  procedural: () => string,
  provider: GeneratedAssetProvider = defaultGeneratedAssetProvider,
): Promise<string> {
  try {
    const generated = await provider.getAsset(kind, descriptor, seed);
    if (generated) return generated;
  } catch {
    // Fall through to the procedural renderer — art failures are never fatal.
  }
  return procedural();
}
