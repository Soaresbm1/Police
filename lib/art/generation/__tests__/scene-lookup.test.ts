import { describe, expect, it, vi } from "vitest";
import { resolveReadySceneUrl, type SceneLookupDeps } from "../scene-lookup";
import { CRIME_SCENE_GENERATION_VERSION, ACTIVE_PROVIDER_NAME } from "../asset-kinds";
import type { CrimeSceneVisualDescriptor } from "../../visual-manifest";
import type { GeneratedAssetRecord } from "../types";

function makeDescriptor(overrides: Partial<CrimeSceneVisualDescriptor> = {}): CrimeSceneVisualDescriptor {
  return {
    locationId: "loc1",
    seed: "loc1:apartment",
    layoutTemplate: "apartment_living_room",
    timeOfDay: "night",
    architectureStyle: "residential_modern",
    weather: "clear",
    ...overrides,
  };
}

function makeRecord(overrides: Partial<GeneratedAssetRecord> = {}): GeneratedAssetRecord {
  return {
    id: "asset-1",
    userId: "user-1",
    caseSeed: "CASE-TEST01",
    assetKind: "crime_scene_environment",
    descriptorHash: "hash-1",
    generationVersion: CRIME_SCENE_GENERATION_VERSION,
    provider: ACTIVE_PROVIDER_NAME,
    providerModel: "@cf/black-forest-labs/flux-1-schnell",
    status: "ready",
    storagePath: "user-1/CASE-TEST01/hash-1.jpeg",
    width: 1024,
    height: 1024,
    promptVersion: 2,
    errorMessage: null,
    attemptCount: 0,
    failedAt: null,
    ...overrides,
  };
}

describe("resolveReadySceneUrl", () => {
  it("returns null when no scene asset is ready (procedural fallback)", async () => {
    const deps: SceneLookupDeps = {
      findAssetRecord: vi.fn().mockResolvedValue(null),
      getSignedAssetUrl: vi.fn(),
    };
    const result = await resolveReadySceneUrl(deps, "user-1", makeDescriptor());
    expect(result).toBeNull();
    expect(deps.getSignedAssetUrl).not.toHaveBeenCalled();
  });

  it("returns the signed URL when the scene is ready", async () => {
    const record = makeRecord();
    const deps: SceneLookupDeps = {
      findAssetRecord: vi.fn().mockResolvedValue(record),
      getSignedAssetUrl: vi.fn().mockResolvedValue("https://example.test/signed-scene-url"),
    };
    const result = await resolveReadySceneUrl(deps, "user-1", makeDescriptor());
    expect(result).toBe("https://example.test/signed-scene-url");
    expect(deps.getSignedAssetUrl).toHaveBeenCalledWith(record.storagePath);
  });

  it("stays null for a queued/generating/failed row — never surfaces a non-ready asset", async () => {
    for (const status of ["queued", "generating", "failed"] as const) {
      const deps: SceneLookupDeps = {
        findAssetRecord: vi.fn().mockResolvedValue(makeRecord({ status, storagePath: null })),
        getSignedAssetUrl: vi.fn(),
      };
      const result = await resolveReadySceneUrl(deps, "user-1", makeDescriptor());
      expect(result).toBeNull();
    }
  });

  it("passes only THIS user's id and the crime-scene generation version to the store", async () => {
    const findSpy = vi.fn().mockResolvedValue(null);
    const deps: SceneLookupDeps = { findAssetRecord: findSpy, getSignedAssetUrl: vi.fn() };
    await resolveReadySceneUrl(deps, "user-A", makeDescriptor());
    expect(findSpy).toHaveBeenCalledWith("user-A", expect.any(String), CRIME_SCENE_GENERATION_VERSION, ACTIVE_PROVIDER_NAME);
  });

  it("degrades to null (never throws) when the store fails", async () => {
    const deps: SceneLookupDeps = {
      findAssetRecord: vi.fn().mockRejectedValue(new Error("Supabase outage")),
      getSignedAssetUrl: vi.fn(),
    };
    await expect(resolveReadySceneUrl(deps, "user-1", makeDescriptor())).resolves.toBeNull();
  });

  it("degrades to null when signing the URL fails after finding a ready row", async () => {
    const deps: SceneLookupDeps = {
      findAssetRecord: vi.fn().mockResolvedValue(makeRecord()),
      getSignedAssetUrl: vi.fn().mockRejectedValue(new Error("storage outage")),
    };
    await expect(resolveReadySceneUrl(deps, "user-1", makeDescriptor())).resolves.toBeNull();
  });
});
