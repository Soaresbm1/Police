import { describe, expect, it, vi } from "vitest";
import {
  MAX_AUTO_CRIME_SCENES_PER_CASE,
  isAutoCrimeSceneGenerationEnabled,
  runAutoCrimeSceneGeneration,
} from "../auto-scene-trigger";
import { MockGeneratedAssetProvider, AlwaysMissingGeneratedAssetProvider } from "../mock-provider";
import type { AssetStoreLike } from "../pipeline";
import type { GeneratedAssetKind, GeneratedAssetRecord } from "../types";
import type { CaseTruth } from "@/lib/game-engine/types/case";
import type { Location } from "@/lib/game-engine/types/location";
import type { Person } from "@/lib/game-engine/types/person";

function makeLocation(overrides: Partial<Location> = {}): Location {
  return {
    id: "loc-crime",
    name: "Appartement",
    type: "apartment",
    address: "1 rue Test",
    district: "Centre",
    coordinates: { x: 2, y: 2 },
    hasCameras: false,
    cameraZones: [],
    hasWifi: false,
    wifiSsid: null,
    hasBadgeAccess: false,
    openingHours: null,
    employeePersonIds: [],
    residentPersonIds: [],
    ...overrides,
  };
}

function makePerson(overrides: Partial<Person> = {}): Person {
  return {
    id: "victim",
    firstName: "Test",
    lastName: "Person",
    age: 40,
    sex: "female",
    lifeStatus: "employed",
    profession: "comptable",
    homeLocationId: "loc-crime",
    workLocationId: null,
    avatarSeed: "seed-abc123",
    personality: { intelligence: 0.5, impulsivity: 0.5, sociability: 0.5, aggressiveness: 0.5, honesty: 0.5, loyalty: 0.5, fearfulness: 0.5 },
    baselineStress: 0.3,
    wealthChf: 50_000,
    addictions: [],
    phoneNumber: "0790000000",
    vehicle: null,
    digitalAccounts: [],
    roles: [],
    ...overrides,
  };
}

function makeTruth(overrides: Partial<CaseTruth> = {}): CaseTruth {
  const victim = makePerson();
  const location = makeLocation();
  return {
    seed: "CASE-TEST01",
    difficulty: "investigator",
    crimeType: "homicide",
    archetype: "crime_of_opportunity",
    generatedAt: new Date().toISOString(),
    locations: [location],
    people: [victim],
    relationships: [],
    victimId: victim.id,
    culpritId: victim.id,
    accompliceIds: [],
    accomplices: [],
    suspectIds: [],
    motive: { type: "revenge", holderId: victim.id, targetId: victim.id, description: "", strength: 0, groundingRelationshipIds: [] },
    suspectMotives: {},
    method: "",
    methodType: "blunt_force",
    weapon: "",
    crimeLocationId: location.id,
    crimeTimestamp: 500,
    premeditated: false,
    staging: { type: "none", staged: false, tellEvidenceIds: [], description: "" },
    falseConfession: null,
    tamperingEvents: [],
    sharedResources: [],
    timeline: [],
    evidence: [],
    knowledge: [],
    testimony: [],
    alibis: [],
    autopsy: {
      estimatedDeathWindowStart: 0,
      estimatedDeathWindowEnd: 0,
      causeOfDeath: "",
      weaponType: "",
      wounds: [],
      substancesFound: [],
      bodyPosition: "",
      notableFeatures: [],
    },
    redHerringPersonIds: [],
    caseOpenedAt: 0,
    postCrimeMovements: [],
    ...overrides,
  };
}

/** In-memory stand-in for `asset-store.ts` — same shape as `pipeline.test.ts`'s/`auto-portrait-trigger.test.ts`'s. */
class FakeAssetStore implements AssetStoreLike {
  rows: GeneratedAssetRecord[] = [];
  private nextId = 1;

  async findAssetRecord(userId: string, descriptorHash: string, generationVersion: number, provider: string) {
    return (
      this.rows.find(
        (r) => r.userId === userId && r.descriptorHash === descriptorHash && r.generationVersion === generationVersion && r.provider === provider,
      ) ?? null
    );
  }

  async createQueuedRecord(
    userId: string,
    caseSeed: string,
    assetKind: GeneratedAssetKind,
    descriptorHash: string,
    generationVersion: number,
    provider: string,
    reuseKey: string | null,
  ) {
    const record: GeneratedAssetRecord = {
      id: String(this.nextId++),
      userId,
      caseSeed,
      assetKind,
      descriptorHash,
      generationVersion,
      provider,
      providerModel: null,
      status: "queued",
      storagePath: null,
      width: null,
      height: null,
      promptVersion: null,
      errorMessage: null,
      attemptCount: 0,
      failedAt: null,
      reuseKey,
      reuseCount: 0,
      sourceAssetId: null,
    };
    this.rows.push(record);
    return record;
  }

  async markGenerating(userId: string, id: string) {
    const r = this.rows.find((x) => x.id === id && x.userId === userId);
    if (r) r.status = "generating";
  }

  async markReady(userId: string, id: string, fields: { storagePath: string; width: number; height: number; providerModel: string; promptVersion: number }) {
    const r = this.rows.find((x) => x.id === id && x.userId === userId);
    if (r) Object.assign(r, { status: "ready", ...fields });
  }

  async markFailed(userId: string, id: string, errorMessage: string, attemptCount: number) {
    const r = this.rows.find((x) => x.id === id && x.userId === userId);
    if (r) Object.assign(r, { status: "failed", errorMessage, attemptCount, failedAt: new Date().toISOString() });
  }

  async countAssetsForCase(userId: string, caseSeed: string) {
    return this.rows.filter((r) => r.userId === userId && r.caseSeed === caseSeed).length;
  }

  async uploadAssetBytes(userId: string, caseSeed: string, descriptorHash: string) {
    return { path: `${userId}/${caseSeed}/${descriptorHash}.svg` };
  }

  async getSignedAssetUrl(path: string) {
    return `https://example.test/signed/${path}`;
  }

  async findReusableAssetCandidates(
    userId: string,
    assetKind: GeneratedAssetKind,
    generationVersion: number,
    provider: string,
    reuseKey: string,
    excludeCaseSeed: string,
    limit: number,
  ) {
    return this.rows
      .filter(
        (r) =>
          r.userId === userId &&
          r.assetKind === assetKind &&
          r.generationVersion === generationVersion &&
          r.provider === provider &&
          r.reuseKey === reuseKey &&
          r.status === "ready" &&
          r.sourceAssetId === null &&
          r.caseSeed !== excludeCaseSeed,
      )
      .sort((a, b) => a.reuseCount - b.reuseCount || a.id.localeCompare(b.id))
      .slice(0, limit);
  }

  async createReusedRecord(
    userId: string,
    caseSeed: string,
    assetKind: GeneratedAssetKind,
    descriptorHash: string,
    generationVersion: number,
    provider: string,
    source: GeneratedAssetRecord,
    reuseKey: string,
    canonicalSourceId: string,
  ) {
    const record: GeneratedAssetRecord = {
      id: String(this.nextId++),
      userId,
      caseSeed,
      assetKind,
      descriptorHash,
      generationVersion,
      provider,
      providerModel: source.providerModel,
      status: "ready",
      storagePath: source.storagePath,
      width: source.width,
      height: source.height,
      promptVersion: source.promptVersion,
      errorMessage: null,
      attemptCount: 0,
      failedAt: null,
      reuseKey,
      reuseCount: 0,
      sourceAssetId: canonicalSourceId,
    };
    this.rows.push(record);
    return record;
  }

  async incrementReuseCount(userId: string, assetId: string) {
    const r = this.rows.find((x) => x.id === assetId && x.userId === userId);
    if (r) r.reuseCount++;
  }
}

describe("isAutoCrimeSceneGenerationEnabled", () => {
  it("defaults to false, and is independent from the portrait flag", () => {
    delete process.env.AUTO_GENERATED_CRIME_SCENES_ENABLED;
    delete process.env.AUTO_GENERATED_PORTRAITS_ENABLED;
    expect(isAutoCrimeSceneGenerationEnabled()).toBe(false);

    process.env.AUTO_GENERATED_PORTRAITS_ENABLED = "true"; // portrait flag ON
    expect(isAutoCrimeSceneGenerationEnabled()).toBe(false); // scene flag still OFF

    process.env.AUTO_GENERATED_CRIME_SCENES_ENABLED = "true";
    expect(isAutoCrimeSceneGenerationEnabled()).toBe(true);

    delete process.env.AUTO_GENERATED_CRIME_SCENES_ENABLED;
    delete process.env.AUTO_GENERATED_PORTRAITS_ENABLED;
  });
});

describe("runAutoCrimeSceneGeneration", () => {
  it("generates exactly one crime-scene environment per case (never more than MAX_AUTO_CRIME_SCENES_PER_CASE)", async () => {
    const truth = makeTruth();
    const store = new FakeAssetStore();
    const provider = new MockGeneratedAssetProvider();

    const diagnostics = await runAutoCrimeSceneGeneration({ store, provider }, "user-1", truth);

    expect(MAX_AUTO_CRIME_SCENES_PER_CASE).toBe(1);
    expect(diagnostics.attempted).toBe(1);
    expect(diagnostics.ready).toBe(1);
    expect(diagnostics.failed).toBe(0);
    expect(provider.calls).toHaveLength(1);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0].assetKind).toBe("crime_scene_environment");
  });

  it("never calls the provider twice for the same case (cache hit on a second run — simulates refresh/navigation/resume/restart)", async () => {
    const truth = makeTruth();
    const store = new FakeAssetStore();
    const provider = new MockGeneratedAssetProvider();

    await runAutoCrimeSceneGeneration({ store, provider }, "user-1", truth);
    expect(provider.calls).toHaveLength(1);

    const second = await runAutoCrimeSceneGeneration({ store, provider }, "user-1", truth);
    expect(provider.calls).toHaveLength(1); // no new call at all
    expect(second.cacheHits).toBe(1);
    expect(second.attempted).toBe(0);
  });

  it("a scene already ready from a prior run is reused with zero further provider calls", async () => {
    const truth = makeTruth();
    const store = new FakeAssetStore();
    const provider = new MockGeneratedAssetProvider();
    const generateSpy = vi.spyOn(provider, "generate");

    const firstRun = await runAutoCrimeSceneGeneration({ store, provider }, "user-1", truth);
    expect(firstRun.ready).toBe(1);
    generateSpy.mockClear();

    const secondRun = await runAutoCrimeSceneGeneration({ store, provider }, "user-1", truth);
    expect(secondRun.cacheHits).toBe(1);
    expect(generateSpy).not.toHaveBeenCalled();
  });

  it("degrades to failed (never throws, never fails case creation) when the provider is unavailable", async () => {
    const truth = makeTruth();
    const store = new FakeAssetStore();
    const provider = new AlwaysMissingGeneratedAssetProvider();

    const diagnostics = await runAutoCrimeSceneGeneration({ store, provider }, "user-1", truth);
    expect(diagnostics.failed).toBe(1);
    expect(diagnostics.ready).toBe(0);
  });

  it("degrades gracefully (skipped, never throws) when the crime location cannot be found", async () => {
    const truth = makeTruth({ crimeLocationId: "does-not-exist" });
    const store = new FakeAssetStore();
    const provider = new MockGeneratedAssetProvider();

    const diagnostics = await runAutoCrimeSceneGeneration({ store, provider }, "user-1", truth);
    expect(diagnostics.skipped).toBe(1);
    expect(diagnostics.attempted).toBe(0);
    expect(provider.calls).toHaveLength(0);
  });

  it("is guilt-safe: changing culprit/staging/accomplices while keeping the same crime location/timestamp never changes the descriptor hash or triggers a second generation", async () => {
    const location = makeLocation();
    const baseTruth = makeTruth({ locations: [location], crimeLocationId: location.id, crimeTimestamp: 700 });
    const truthWithDifferentCulprit = makeTruth({
      locations: [location],
      crimeLocationId: location.id,
      crimeTimestamp: 700,
      culpritId: "someone-else",
      accompliceIds: ["accomplice-1"],
      staging: { type: "burglary", staged: true, tellEvidenceIds: ["ev1"], description: "staged for real" },
    });

    const store = new FakeAssetStore();
    const provider = new MockGeneratedAssetProvider();

    const first = await runAutoCrimeSceneGeneration({ store, provider }, "user-1", baseTruth);
    expect(first.attempted).toBe(1);

    // Same public location/timestamp, wildly different hidden CaseTruth —
    // must resolve as the exact same cached asset, not a new generation.
    const second = await runAutoCrimeSceneGeneration({ store, provider }, "user-1", truthWithDifferentCulprit);
    expect(second.cacheHits).toBe(1);
    expect(second.attempted).toBe(0);
    expect(provider.calls).toHaveLength(1); // still just the one real call
  });

  describe("same-user reusable scenes (Generated Art V2B)", () => {
    it("[E] a compatible scene from a DIFFERENT case (same layout/time-of-day/architecture) is reused with zero provider calls", async () => {
      // "office" has exactly one layout candidate (see crime-scene-layouts.ts),
      // so two different locations of this type always resolve to the same
      // layoutTemplate/architectureStyle regardless of their own id/seed —
      // the two cases below are genuinely reuse-compatible.
      const locationA = makeLocation({ id: "loc-office-a", type: "office" });
      const locationB = makeLocation({ id: "loc-office-b", type: "office" });
      const store = new FakeAssetStore();
      const provider = new MockGeneratedAssetProvider();

      const truthA = makeTruth({ seed: "CASE-A", locations: [locationA], crimeLocationId: locationA.id, crimeTimestamp: 700 });
      const first = await runAutoCrimeSceneGeneration({ store, provider }, "user-1", truthA);
      expect(first.attempted).toBe(1);
      expect(first.reuseHits).toBe(0);

      const truthB = makeTruth({ seed: "CASE-B", locations: [locationB], crimeLocationId: locationB.id, crimeTimestamp: 700 });
      const second = await runAutoCrimeSceneGeneration({ store, provider }, "user-1", truthB);
      expect(second.ready).toBe(1);
      expect(second.reuseHits).toBe(1);
      expect(provider.calls).toHaveLength(1); // no new Cloudflare call for the second case's scene
    });

    it("[F] an incompatible scene (different layout template) still generates for real", async () => {
      const officeLocation = makeLocation({ id: "loc-office", type: "office" });
      const warehouseLocation = makeLocation({ id: "loc-warehouse", type: "warehouse" });
      const store = new FakeAssetStore();
      const provider = new MockGeneratedAssetProvider();

      const truthOffice = makeTruth({ seed: "CASE-OFFICE", locations: [officeLocation], crimeLocationId: officeLocation.id, crimeTimestamp: 700 });
      await runAutoCrimeSceneGeneration({ store, provider }, "user-1", truthOffice);

      const truthWarehouse = makeTruth({ seed: "CASE-WAREHOUSE", locations: [warehouseLocation], crimeLocationId: warehouseLocation.id, crimeTimestamp: 700 });
      const result = await runAutoCrimeSceneGeneration({ store, provider }, "user-1", truthWarehouse);

      expect(result.reuseHits).toBe(0);
      expect(result.ready).toBe(1);
      expect(provider.calls).toHaveLength(2); // a genuinely new real generation
    });
  });
});
