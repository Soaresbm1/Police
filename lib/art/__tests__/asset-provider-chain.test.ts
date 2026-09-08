import { describe, expect, it } from "vitest";
import { resolveAsset } from "../asset-provider-chain";
import { generatedAssetProvider } from "../generated-asset-provider";
import type { GeneratedAssetProvider, GeneratedAssetResult } from "../generated-asset-provider";

function makeResult(overrides: Partial<GeneratedAssetResult> = {}): GeneratedAssetResult {
  return {
    bytes: new Uint8Array([1, 2, 3]),
    contentType: "image/png",
    width: 64,
    height: 64,
    model: "mock-v1",
    ...overrides,
  };
}

describe("resolveAsset", () => {
  it("falls back to the procedural renderer with the default (null) generated provider", async () => {
    const asset = await resolveAsset("character_portrait", "a prompt", "x", () => "procedural-fallback");
    expect(asset).toBe("procedural-fallback");
    expect(await generatedAssetProvider.generate("character_portrait", "a prompt", "x")).toBeNull();
  });

  it("uses the generated asset (as a data URI) when an injected provider returns one", async () => {
    const stub: GeneratedAssetProvider = { generate: async () => makeResult() };
    const asset = await resolveAsset("character_portrait", "a prompt", "x", () => "procedural-fallback", stub);
    expect(asset).toMatch(/^data:image\/png;base64,/);
  });

  it("falls back to procedural when the generated provider throws", async () => {
    const throwing: GeneratedAssetProvider = {
      generate: async () => {
        throw new Error("backend unavailable");
      },
    };
    const asset = await resolveAsset("character_portrait", "a prompt", "x", () => "procedural-fallback", throwing);
    expect(asset).toBe("procedural-fallback");
  });

  it("falls back to procedural when the generated provider resolves null", async () => {
    const nullish: GeneratedAssetProvider = { generate: async () => null };
    const asset = await resolveAsset("character_portrait", "a prompt", "x", () => "procedural-fallback", nullish);
    expect(asset).toBe("procedural-fallback");
  });
});
