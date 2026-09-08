import { NullGeneratedAssetProvider, type GeneratedAssetProvider } from "../generated-asset-provider";
import { CloudflareGeneratedAssetProvider, isCloudflareConfigured } from "./providers/cloudflare-provider";

/**
 * The provider actually wired up for real gameplay use, chosen once from
 * environment configuration. Falls back to the always-procedural null
 * provider when Cloudflare credentials are absent — CASELINE never
 * crashes or blocks case creation on missing configuration; it simply
 * never leaves the procedural renderers.
 *
 * This is the one place server code (a Server Action, a dev tool) should
 * import a "real" provider from — gameplay code otherwise stays entirely
 * unaware providers exist at all, only ever seeing `getOrGenerateAsset()`'s
 * plain result.
 */
export const activeGeneratedAssetProvider: GeneratedAssetProvider = isCloudflareConfigured()
  ? new CloudflareGeneratedAssetProvider()
  : new NullGeneratedAssetProvider();

export { isCloudflareConfigured };
