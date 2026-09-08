/**
 * The seam a real image-generation backend plugs into later. Nothing in
 * this file calls an external service, holds an API key, or depends on a
 * specific vendor — the default implementation always declines, which
 * tells every caller (via `resolveAsset` in `asset-provider-chain.ts`) to
 * fall back to the procedural renderer. Swapping `generatedAssetProvider`
 * for a real backend is the only change needed anywhere in the app.
 */
export interface GeneratedAssetProvider {
  /**
   * Attempts to produce a real generated asset for the given descriptor.
   * `kind` namespaces the descriptor shape (e.g. "portrait", "crime_scene",
   * "evidence", "cctv_frame", "location"). Returns `null` when unavailable
   * — never throws, so callers can always fall back safely.
   */
  getAsset(kind: string, descriptor: unknown, seed: string): Promise<string | null>;
}

export class NullGeneratedAssetProvider implements GeneratedAssetProvider {
  async getAsset(): Promise<string | null> {
    return null;
  }
}

export const generatedAssetProvider: GeneratedAssetProvider = new NullGeneratedAssetProvider();
