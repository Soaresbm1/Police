import { describe, expect, it } from "vitest";
import { isCloudflareConfigured } from "../providers/cloudflare-provider";

/**
 * `active-provider.ts` itself picks its exported singleton at MODULE LOAD
 * time (`isCloudflareConfigured() ? new CloudflareGeneratedAssetProvider()
 * : new NullGeneratedAssetProvider()`), so it can't be re-tested per test
 * case by toggling env vars after import — Vitest would need a fresh
 * module registry per case. The selection *logic* it depends on
 * (`isCloudflareConfigured`) is fully covered in
 * `providers/__tests__/cloudflare-provider.test.ts`; this test only
 * confirms the module actually exports something usable in this
 * (unconfigured, by default in CI) environment.
 */
describe("activeGeneratedAssetProvider", () => {
  it("resolves to the null provider when Cloudflare credentials are absent in this test environment", async () => {
    expect(isCloudflareConfigured()).toBe(false);
    const { activeGeneratedAssetProvider } = await import("../active-provider");
    const result = await activeGeneratedAssetProvider.generate("character_portrait", "a prompt", "seed-1");
    expect(result).toBeNull();
  });
});
