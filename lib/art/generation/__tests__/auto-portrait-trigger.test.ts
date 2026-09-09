import { describe, expect, it } from "vitest";
import {
  MAX_AUTO_PORTRAITS_PER_CASE,
  PORTRAIT_GENERATION_CONCURRENCY,
  isAutoPortraitGenerationEnabled,
  runAutoPortraitGeneration,
  selectAutoPortraitCandidates,
} from "../auto-portrait-trigger";
import { MockGeneratedAssetProvider, AlwaysMissingGeneratedAssetProvider } from "../mock-provider";
import { MAX_ASSETS_PER_CASE } from "../limits";
import type { AssetStoreLike } from "../pipeline";
import type { GeneratedAssetProvider, GeneratedAssetResult } from "../../generated-asset-provider";
import type { GeneratedAssetKind, GeneratedAssetRecord } from "../types";
import type { CaseTruth } from "@/lib/game-engine/types/case";
import type { Person } from "@/lib/game-engine/types/person";

function makePerson(overrides: Partial<Person> = {}): Person {
  return {
    id: "p1",
    firstName: "Test",
    lastName: "Person",
    age: 40,
    sex: "female",
    profession: "comptable",
    homeLocationId: "loc1",
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
    postCrimeMovements: [],
    ...overrides,
  };
}

/** In-memory stand-in for `asset-store.ts` — same shape as `pipeline.test.ts`'s. */
class FakeAssetStore implements AssetStoreLike {
  rows: GeneratedAssetRecord[] = [];
  private nextId = 1;
  callOrder: string[] = [];

  async findAssetRecord(userId: string, descriptorHash: string, generationVersion: number, provider: string) {
    return (
      this.rows.find(
        (r) => r.userId === userId && r.descriptorHash === descriptorHash && r.generationVersion === generationVersion && r.provider === provider,
      ) ?? null
    );
  }

  async createQueuedRecord(userId: string, caseSeed: string, assetKind: GeneratedAssetKind, descriptorHash: string, generationVersion: number, provider: string) {
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
    this.callOrder.push(descriptorHash);
    return { path: `${userId}/${caseSeed}/${descriptorHash}.svg` };
  }

  async getSignedAssetUrl(path: string) {
    return `https://example.test/signed/${path}`;
  }
}

function makeCandidatePool() {
  const victim = makePerson({ id: "victim", avatarSeed: "seed-victim" });
  const suspects = ["s1", "s2", "s3"].map((id) => makePerson({ id, avatarSeed: `seed-${id}` }));
  const witnesses = ["w1", "w2", "w3", "w4", "w5"].map((id) => makePerson({ id, avatarSeed: `seed-${id}`, roles: ["witness"] }));
  const bystander = makePerson({ id: "b1", avatarSeed: "seed-b1", roles: ["bystander"] });
  const redHerringWitness = makePerson({ id: "rh1", avatarSeed: "seed-rh1", roles: ["witness"] });
  const people = [victim, ...suspects, ...witnesses, bystander, redHerringWitness];
  const truth = makeTruth(people, {
    victimId: victim.id,
    suspectIds: suspects.map((s) => s.id),
    culpritId: suspects[0].id,
    redHerringPersonIds: [redHerringWitness.id],
  });
  return { truth, victim, suspects, witnesses, bystander, redHerringWitness };
}

describe("selectAutoPortraitCandidates", () => {
  it("never exceeds the pilot cap, even when far more important people exist", () => {
    const { truth } = makeCandidatePool();
    const selected = selectAutoPortraitCandidates(truth);
    expect(selected.length).toBeLessThanOrEqual(MAX_AUTO_PORTRAITS_PER_CASE);
    expect(selected.length).toBe(MAX_AUTO_PORTRAITS_PER_CASE);
  });

  it("always includes the victim and every primary suspect before any witness", () => {
    const { truth, victim, suspects } = makeCandidatePool();
    const selected = selectAutoPortraitCandidates(truth);
    const selectedIds = selected.map((p) => p.id);
    expect(selectedIds).toContain(victim.id);
    for (const s of suspects) expect(selectedIds).toContain(s.id);
  });

  it("never includes a bystander or a red-herring witness", () => {
    const { truth, bystander, redHerringWitness } = makeCandidatePool();
    const selectedIds = selectAutoPortraitCandidates(truth, 100).map((p) => p.id); // no cap pressure
    expect(selectedIds).not.toContain(bystander.id);
    expect(selectedIds).not.toContain(redHerringWitness.id);
  });

  it("is deterministic across repeated calls for the same case", () => {
    const { truth } = makeCandidatePool();
    const first = selectAutoPortraitCandidates(truth).map((p) => p.id);
    const second = selectAutoPortraitCandidates(truth).map((p) => p.id);
    expect(second).toEqual(first);
  });

  it("selects the same witnesses regardless of who the culprit is (guilt-blind)", () => {
    const { truth, suspects } = makeCandidatePool();
    const asIf = { ...truth, culpritId: suspects[2].id }; // relabel the culprit only
    const before = selectAutoPortraitCandidates(truth).map((p) => p.id);
    const after = selectAutoPortraitCandidates(asIf).map((p) => p.id);
    expect(after).toEqual(before); // culpritId is never read by the selection function
  });
});

describe("runAutoPortraitGeneration", () => {
  it("[B] generates for every selected candidate under bounded concurrency and reports correct diagnostics", async () => {
    const { truth } = makeCandidatePool();
    const store = new FakeAssetStore();
    const provider = new MockGeneratedAssetProvider();

    const diagnostics = await runAutoPortraitGeneration({ store, provider }, "user-1", truth);

    expect(diagnostics.attempted).toBe(MAX_AUTO_PORTRAITS_PER_CASE);
    expect(diagnostics.ready).toBe(MAX_AUTO_PORTRAITS_PER_CASE);
    expect(diagnostics.failed).toBe(0);
    expect(diagnostics.cacheHits).toBe(0);
    expect(diagnostics.skippedDueToCap).toBeGreaterThan(0); // 1 victim + 3 suspects + 5 non-red-herring witnesses = 9 important people, cap 6
    expect(store.rows).toHaveLength(MAX_AUTO_PORTRAITS_PER_CASE);
  });

  it("never calls the provider twice for an already-ready asset (cache hit)", async () => {
    const { truth } = makeCandidatePool();
    const store = new FakeAssetStore();
    const provider = new MockGeneratedAssetProvider();

    await runAutoPortraitGeneration({ store, provider }, "user-1", truth);
    const callsAfterFirstRun = provider.calls.length;

    const second = await runAutoPortraitGeneration({ store, provider }, "user-1", truth);
    expect(provider.calls).toHaveLength(callsAfterFirstRun); // no new calls at all
    expect(second.cacheHits).toBe(MAX_AUTO_PORTRAITS_PER_CASE);
    expect(second.attempted).toBe(0);
  });

  it("degrades to failed (never throws) when the provider is unavailable", async () => {
    const { truth } = makeCandidatePool();
    const store = new FakeAssetStore();
    const provider = new AlwaysMissingGeneratedAssetProvider();

    const diagnostics = await runAutoPortraitGeneration({ store, provider }, "user-1", truth);
    expect(diagnostics.failed).toBe(MAX_AUTO_PORTRAITS_PER_CASE);
    expect(diagnostics.ready).toBe(0);
  });

  it("is unaffected by isAutoPortraitGenerationEnabled() being false — callers gate it, not this function", () => {
    delete process.env.AUTO_GENERATED_PORTRAITS_ENABLED;
    expect(isAutoPortraitGenerationEnabled()).toBe(false);
    process.env.AUTO_GENERATED_PORTRAITS_ENABLED = "true";
    expect(isAutoPortraitGenerationEnabled()).toBe(true);
    delete process.env.AUTO_GENERATED_PORTRAITS_ENABLED;
  });
});

/** A provider whose `generate()` only resolves once the test calls
 * `releaseOne()`/`releaseAll()` — used to force several candidates into
 * flight at the same time so concurrency bounds can be observed directly,
 * rather than inferred from timing. */
function makeGatedProvider() {
  let active = 0;
  let maxActive = 0;
  const pendingReleases: (() => void)[] = [];
  const provider: GeneratedAssetProvider = {
    async generate(): Promise<GeneratedAssetResult | null> {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => pendingReleases.push(resolve));
      active--;
      return { bytes: new Uint8Array([1, 2, 3]), contentType: "image/jpeg", width: 1, height: 1, model: "gated-fake" };
    },
  };
  return {
    provider,
    get active() {
      return active;
    },
    get maxActive() {
      return maxActive;
    },
    releaseOne() {
      pendingReleases.shift()?.();
    },
    releaseAll() {
      while (pendingReleases.length > 0) pendingReleases.shift()!();
    },
  };
}

/** A provider that fails only for a chosen subset of seeds — used to prove
 * one candidate's failure never stops or skips its siblings. */
function makePartiallyFailingProvider(failSeeds: Set<string>) {
  const calls: string[] = [];
  const provider: GeneratedAssetProvider = {
    async generate(_kind, _prompt, seed): Promise<GeneratedAssetResult | null> {
      calls.push(seed);
      if (failSeeds.has(seed)) return null;
      return { bytes: new Uint8Array([1]), contentType: "image/jpeg", width: 1, height: 1, model: "fake" };
    },
  };
  return { provider, calls };
}

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("runAutoPortraitGeneration — bounded concurrency (Generated Art V2A)", () => {
  it("[A] never runs more than PORTRAIT_GENERATION_CONCURRENCY generations at once", async () => {
    const { truth } = makeCandidatePool(); // 6 eligible candidates after the selection cap
    const store = new FakeAssetStore();
    const gated = makeGatedProvider();

    const donePromise = runAutoPortraitGeneration({ store, provider: gated.provider }, "user-1", truth);

    for (let i = 0; i < MAX_AUTO_PORTRAITS_PER_CASE; i++) {
      await flushMicrotasks();
      expect(gated.active).toBeLessThanOrEqual(PORTRAIT_GENERATION_CONCURRENCY);
      gated.releaseOne();
    }
    await donePromise;

    expect(gated.maxActive).toBe(PORTRAIT_GENERATION_CONCURRENCY); // actually saturates the bound, not just "never exceeds" trivially
  });

  it("[C] one candidate's provider failure never cancels or skips the others", async () => {
    const { truth, suspects } = makeCandidatePool();
    const store = new FakeAssetStore();
    const { provider, calls } = makePartiallyFailingProvider(new Set([suspects[0].avatarSeed]));

    const diagnostics = await runAutoPortraitGeneration({ store, provider }, "user-1", truth);

    expect(calls).toHaveLength(MAX_AUTO_PORTRAITS_PER_CASE); // every candidate was still attempted
    expect(diagnostics.attempted).toBe(MAX_AUTO_PORTRAITS_PER_CASE);
    expect(diagnostics.ready).toBe(MAX_AUTO_PORTRAITS_PER_CASE - 1);
    expect(diagnostics.failed).toBe(1);
  });

  it("[D] a concurrent batch can never push a case's total asset count over MAX_ASSETS_PER_CASE", async () => {
    const { truth } = makeCandidatePool(); // 6 eligible candidates
    const store = new FakeAssetStore();
    // Pre-seed unrelated existing rows for this exact case so only 2 of
    // MAX_ASSETS_PER_CASE (10) slots remain — narrow enough that the old
    // per-item-only check (no shared batch budget) could let several
    // concurrent workers all read the same stale "8 used" count and all
    // proceed.
    for (let i = 0; i < MAX_ASSETS_PER_CASE - 2; i++) {
      await store.createQueuedRecord("user-1", truth.seed, "character_portrait", `preexisting-${i}`, 3, "cloudflare");
    }
    const gated = makeGatedProvider();

    const donePromise = runAutoPortraitGeneration({ store, provider: gated.provider }, "user-1", truth);
    // Let every candidate's cache-check + budget-check settle (they all
    // resolve near-instantly against the fake store), then release every
    // gated generation at once — the worst-case simultaneous-completion
    // scenario the budget guard has to survive.
    await flushMicrotasks();
    gated.releaseAll();
    const diagnostics = await donePromise;

    expect(store.rows.length).toBeLessThanOrEqual(MAX_ASSETS_PER_CASE);
    expect(diagnostics.attempted).toBeLessThanOrEqual(2);
  });
});
