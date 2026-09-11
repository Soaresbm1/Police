import { describe, expect, it, vi } from "vitest";
import { resolveReadyPortraitUrls, type PortraitLookupDeps } from "../portrait-lookup";
import { CHARACTER_PORTRAIT_GENERATION_VERSION, ACTIVE_PROVIDER_NAME } from "../asset-kinds";
import { buildCharacterVisualDescriptor } from "../../visual-manifest";
import { hashDescriptor } from "../../asset-cache";
import type { GeneratedAssetRecord } from "../types";
import type { CaseTruth } from "@/lib/game-engine/types/case";
import type { Person } from "@/lib/game-engine/types/person";

function makePerson(overrides: Partial<Person> = {}): Person {
  return {
    id: "p1",
    firstName: "Test",
    lastName: "Person",
    age: 40,
    sex: "female",
    lifeStatus: "employed",
    profession: "comptable",
    homeLocationId: "loc1",
    workLocationId: null,
    avatarSeed: "seed-abc123",
    personality: {
      intelligence: 0.5,
      impulsivity: 0.5,
      sociability: 0.5,
      aggressiveness: 0.5,
      honesty: 0.5,
      loyalty: 0.5,
      fearfulness: 0.5,
    },
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

function makeTruth(people: Person[], overrides: Partial<CaseTruth> = {}): CaseTruth {
  const victim = people[0];
  return {
    seed: "CASE-TEST01",
    difficulty: "investigator",
    crimeType: "homicide",
    archetype: "crime_of_opportunity",
    generatedAt: new Date().toISOString(),
    locations: [],
    people,
    relationships: [],
    victimId: victim.id,
    culpritId: people[1]?.id ?? victim.id,
    accompliceIds: [],
    accomplices: [],
    suspectIds: people[1] ? [people[1].id] : [],
    motive: { type: "revenge", holderId: victim.id, targetId: victim.id, description: "", strength: 0, groundingRelationshipIds: [] },
    suspectMotives: {},
    method: "",
    methodType: "blunt_force",
    weapon: "",
    crimeLocationId: "loc1",
    crimeTimestamp: 0,
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
    victimPhone: { ownerPersonId: victim.id, contacts: [], conversations: [], calls: [] },
    ...overrides,
  };
}

function makeRecord(overrides: Partial<GeneratedAssetRecord> = {}): GeneratedAssetRecord {
  return {
    id: "asset-1",
    userId: "user-1",
    caseSeed: "CASE-TEST01",
    assetKind: "character_portrait",
    descriptorHash: "hash-1",
    generationVersion: CHARACTER_PORTRAIT_GENERATION_VERSION,
    provider: ACTIVE_PROVIDER_NAME,
    providerModel: "@cf/black-forest-labs/flux-1-schnell",
    status: "ready",
    storagePath: "user-1/CASE-TEST01/hash-1.jpeg",
    width: 1024,
    height: 1024,
    promptVersion: 3,
    errorMessage: null,
    attemptCount: 0,
    failedAt: null,
    reuseKey: null,
    reuseCount: 0,
    sourceAssetId: null,
    ...overrides,
  };
}

describe("resolveReadyPortraitUrls", () => {
  it("returns an empty map when no assets are ready (pure procedural fallback)", async () => {
    const victim = makePerson({ id: "victim", avatarSeed: "seed-victim" });
    const truth = makeTruth([victim]);
    const deps: PortraitLookupDeps = {
      findReadyAssetsByHashes: vi.fn().mockResolvedValue([]),
      getSignedAssetUrls: vi.fn().mockResolvedValue(new Map()),
    };

    const result = await resolveReadyPortraitUrls(deps, "user-1", truth);
    expect(result.size).toBe(0);
  });

  it("returns the signed URL for a person whose portrait is ready", async () => {
    const victim = makePerson({ id: "victim", avatarSeed: "seed-victim" });
    const truth = makeTruth([victim]);
    const hash = hashDescriptor(buildCharacterVisualDescriptor(victim));
    const path = `user-1/CASE-TEST01/${hash}.jpeg`;

    const deps: PortraitLookupDeps = {
      findReadyAssetsByHashes: vi.fn().mockResolvedValue([makeRecord({ descriptorHash: hash, storagePath: path })]),
      getSignedAssetUrls: vi.fn().mockResolvedValue(new Map([[path, "https://example.test/signed-url"]])),
    };

    const result = await resolveReadyPortraitUrls(deps, "user-1", truth);
    expect(result.get("victim")).toBe("https://example.test/signed-url");
  });

  it("passes only THIS user's id to the store — never another user's rows", async () => {
    const victim = makePerson({ id: "victim", avatarSeed: "seed-victim" });
    const truth = makeTruth([victim]);
    const findSpy = vi.fn().mockResolvedValue([]);
    const deps: PortraitLookupDeps = { findReadyAssetsByHashes: findSpy, getSignedAssetUrls: vi.fn().mockResolvedValue(new Map()) };

    await resolveReadyPortraitUrls(deps, "user-A", truth);
    expect(findSpy).toHaveBeenCalledWith("user-A", truth.seed, "character_portrait", CHARACTER_PORTRAIT_GENERATION_VERSION, ACTIVE_PROVIDER_NAME, expect.any(Array));
  });

  it("never calls the store when there are no important people (nobody qualifies as victim/suspect/non-red-herring witness)", async () => {
    const bystander = makePerson({ id: "bystander", avatarSeed: "seed-bystander", roles: ["bystander"] });
    const truth = makeTruth([bystander], { victimId: "someone-else", suspectIds: [] });
    const findSpy = vi.fn();
    const deps: PortraitLookupDeps = { findReadyAssetsByHashes: findSpy, getSignedAssetUrls: vi.fn() };

    const result = await resolveReadyPortraitUrls(deps, "user-1", truth);
    expect(result.size).toBe(0);
    expect(findSpy).not.toHaveBeenCalled();
  });

  it("degrades to procedural (empty map) rather than throwing when the store fails", async () => {
    const victim = makePerson({ id: "victim", avatarSeed: "seed-victim" });
    const truth = makeTruth([victim]);
    const deps: PortraitLookupDeps = {
      findReadyAssetsByHashes: vi.fn().mockRejectedValue(new Error("Supabase outage")),
      getSignedAssetUrls: vi.fn(),
    };

    await expect(resolveReadyPortraitUrls(deps, "user-1", truth)).resolves.toEqual(new Map());
  });

  it("never queries generation for a bystander/red herring excluded from the pilot scope", async () => {
    const victim = makePerson({ id: "victim", avatarSeed: "seed-victim" });
    const bystander = makePerson({ id: "bystander", avatarSeed: "seed-bystander", roles: ["bystander"] });
    const truth = makeTruth([victim, bystander], { suspectIds: [], culpritId: victim.id });
    const findSpy = vi.fn().mockResolvedValue([]);
    const deps: PortraitLookupDeps = { findReadyAssetsByHashes: findSpy, getSignedAssetUrls: vi.fn().mockResolvedValue(new Map()) };

    await resolveReadyPortraitUrls(deps, "user-1", truth);
    const requestedHashes = findSpy.mock.calls[0][5] as string[];
    const bystanderHash = hashDescriptor(buildCharacterVisualDescriptor(bystander));
    expect(requestedHashes).not.toContain(bystanderHash);
  });

  it("[G] repeated calls (simulating router.refresh()'s ArtRefreshWatcher nudge) only ever call the two read-only deps — never a generation entry point", async () => {
    const victim = makePerson({ id: "victim", avatarSeed: "seed-victim" });
    const truth = makeTruth([victim]);
    const findSpy = vi.fn().mockResolvedValue([]);
    const signSpy = vi.fn().mockResolvedValue(new Map());
    // PortraitLookupDeps has exactly two fields — there is structurally no
    // generation-capable method available to call even if this function's
    // implementation changed to try.
    const deps: PortraitLookupDeps = { findReadyAssetsByHashes: findSpy, getSignedAssetUrls: signSpy };

    for (let i = 0; i < 3; i++) {
      await resolveReadyPortraitUrls(deps, "user-1", truth);
    }

    expect(findSpy).toHaveBeenCalledTimes(3);
    expect(Object.keys(deps)).toEqual(["findReadyAssetsByHashes", "getSignedAssetUrls"]);
  });
});
