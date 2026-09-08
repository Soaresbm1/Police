import { describe, expect, it } from "vitest";
import { resolveAsset } from "../asset-provider-chain";
import { generatedAssetProvider } from "../generated-asset-provider";
import type { GeneratedAssetProvider } from "../generated-asset-provider";

describe("resolveAsset", () => {
  it("falls back to the procedural renderer with the default (null) generated provider", async () => {
    const asset = await resolveAsset("portrait", { seed: "x" }, "x", () => "procedural-fallback");
    expect(asset).toBe("procedural-fallback");
    expect(await generatedAssetProvider.getAsset("portrait", {}, "x")).toBeNull();
  });

  it("uses the generated asset when an injected provider returns one", async () => {
    const stub: GeneratedAssetProvider = { getAsset: async () => "generated-asset-url" };
    const asset = await resolveAsset("portrait", { seed: "x" }, "x", () => "procedural-fallback", stub);
    expect(asset).toBe("generated-asset-url");
  });

  it("falls back to procedural when the generated provider throws", async () => {
    const throwing: GeneratedAssetProvider = {
      getAsset: async () => {
        throw new Error("backend unavailable");
      },
    };
    const asset = await resolveAsset("portrait", {}, "x", () => "procedural-fallback", throwing);
    expect(asset).toBe("procedural-fallback");
  });

  it("falls back to procedural when the generated provider resolves null", async () => {
    const nullish: GeneratedAssetProvider = { getAsset: async () => null };
    const asset = await resolveAsset("portrait", {}, "x", () => "procedural-fallback", nullish);
    expect(asset).toBe("procedural-fallback");
  });
});
