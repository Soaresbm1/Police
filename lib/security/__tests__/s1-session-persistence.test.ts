import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "./fake-supabase";

let fake = new FakeSupabase();
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: async () => fake }));

let currentUserId = "user-s1";
vi.mock("@/lib/game-session/identity", () => ({
  getCurrentIdentity: async () => ({ userId: currentUserId, authenticated: true, displayEmail: null }),
}));

import { generateCase } from "@/lib/game-engine/case-generator/case-truth";
import { generateCaseSeed } from "@/lib/game-engine/random/rng";
import { SupabaseSessionStore } from "@/lib/game-session/persistence/supabase-store";
import { getActiveCaseReconstruction, getArchivedCaseReconstruction } from "@/lib/game-session/reconstruction-release";
import * as assetStore from "@/lib/art/generation/asset-store";
import { getOrGenerateAsset } from "@/lib/art/generation/pipeline";
import { MockGeneratedAssetProvider } from "@/lib/art/generation/mock-provider";
import { getReadyPortraitUrls } from "@/lib/art/generation/portrait-lookup";
import { importantPeopleForPortraits } from "@/lib/art/generation/pilot-scope";
import { buildCharacterVisualDescriptor } from "@/lib/art/visual-manifest";
import { hashDescriptor } from "@/lib/art/asset-cache";
import { ACTIVE_PROVIDER_NAME, CHARACTER_PORTRAIT_GENERATION_VERSION } from "@/lib/art/generation/asset-kinds";
import { caseAssetKeysFor, computeCaseRef } from "../case-ref";
import { S1ConfigError, S1_MASTER_SECRET_ENV } from "../s1-keys";
import { SeedEnvelopeError } from "../seed-envelope";

const ORIGINAL_ENV = { ...process.env };

function seedCode(seed: string): string {
  return seed.replace(/^CASE-/, "").replace(/-/g, "");
}

/** True when `text` exposes the seed in any spelling a player could use. */
function leaksSeed(text: string, seed: string): boolean {
  const code = seedCode(seed);
  const decoded = (() => {
    try {
      return decodeURIComponent(text);
    } catch {
      return text;
    }
  })();
  return [text, decoded].some((t) => t.includes(seed) || t.toUpperCase().includes(code));
}

/** Also inspects JWT-looking tokens inside signed URLs. */
function signedUrlLeaksSeed(url: string, seed: string): boolean {
  const token = new URL(url).searchParams.get("token") ?? "";
  const payload = token.split(".")[1] ?? "";
  return leaksSeed(url, seed) || leaksSeed(Buffer.from(payload, "base64url").toString("utf8"), seed);
}

function legacyRow(userId: string, seed: string) {
  return {
    user_id: userId,
    seed,
    difficulty: "investigator",
    current_time_minutes: 612,
    evidence_status: { ev_a: "collected", ev_b: "analyzed" },
    lab_queue: [{ evidenceId: "ev_b", analysisType: "dna", submittedAt: 500, readyAt: 560 }],
    investigation_events: [],
    notes: "notes du joueur",
    player_timeline: [],
    interrogated: { person_x: ["fact_1"] },
    mandates: {},
    surveillance: {},
    board: { nodes: [], edges: [] },
    accusation: null,
    crime_scene_examined: true,
    crime_scene_inspected_zone_ids: ["zone-1"],
    last_action_message: null,
    last_revealed_evidence_ids: [],
    hint_state: { progress: {}, history: [], totalHintsUsed: 0 },
    created_at: "2026-09-01T10:00:00.000Z",
    updated_at: "2026-09-01T11:00:00.000Z",
  };
}

beforeEach(() => {
  fake = new FakeSupabase();
  process.env = {
    ...ORIGINAL_ENV,
    NEXT_PUBLIC_SUPABASE_URL: "https://fakeprojectref00000000.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-test-key",
    [S1_MASTER_SECRET_ENV]: randomBytes(32).toString("base64url"),
  };
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("S1 — encrypted active-session persistence (direct DB row)", () => {
  it("a new session row stores only a versioned envelope — the row a player can read contains no plaintext seed", async () => {
    const store = new SupabaseSessionStore();
    const seed = generateCaseSeed();
    await store.createSession("user-new", seed, "investigator", 480);

    const row = fake.tables.investigation_sessions[0];
    expect(String(row.seed)).toMatch(/^s1e\.v1\./);
    expect(leaksSeed(JSON.stringify(row), seed)).toBe(false);

    const loaded = await store.getActiveSession("user-new");
    expect(loaded!.seed).toBe(seed);
  });

  it("repeated saves of a loaded session reuse the stored ciphertext instead of re-encrypting", async () => {
    const store = new SupabaseSessionStore();
    await store.createSession("user-save", generateCaseSeed(), "investigator", 480);
    const stored = fake.tables.investigation_sessions[0].seed;

    const session = (await store.getActiveSession("user-save"))!;
    session.notes = "a";
    await store.saveSession("user-save", session);
    session.notes = "b";
    await store.saveSession("user-save", session);
    const reloaded = (await store.getActiveSession("user-save"))!;
    await store.saveSession("user-save", reloaded);

    expect(fake.tables.investigation_sessions[0].seed).toBe(stored);
    expect(fake.tables.investigation_sessions[0].notes).toBe("b");
  });

  it("fails closed without S1 configuration: no new case is written and an encrypted session is an error, never 'no investigation'", async () => {
    const store = new SupabaseSessionStore();
    await store.createSession("user-cfg", generateCaseSeed(), "investigator", 480);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    delete process.env[S1_MASTER_SECRET_ENV];
    const writesBefore = fake.writes.length;
    await expect(store.createSession("user-cfg-2", generateCaseSeed(), "investigator", 480)).rejects.toBeInstanceOf(S1ConfigError);
    expect(fake.writes.length).toBe(writesBefore);
    expect(fake.tables.investigation_sessions).toHaveLength(1);

    await expect(store.getActiveSession("user-cfg")).rejects.toBeInstanceOf(S1ConfigError);
    const logged = errors.mock.calls.flat().join("\n");
    expect(logged).toContain("S1_CONFIG_MISSING");
    expect(logged).not.toContain(String(fake.tables.investigation_sessions[0].seed));
  });

  it("an envelope copied onto another user's row fails authentication (AAD binding)", async () => {
    const store = new SupabaseSessionStore();
    await store.createSession("user-a", generateCaseSeed(), "investigator", 480);
    vi.spyOn(console, "error").mockImplementation(() => {});
    fake.tables.investigation_sessions.push({ ...legacyRow("user-b", "CASE-AAAAAA"), seed: fake.tables.investigation_sessions[0].seed });

    const failure = await store.getActiveSession("user-b").catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(SeedEnvelopeError);
    expect((failure as SeedEnvelopeError).code).toBe("AUTHENTICATION_FAILED");
  });
});

describe("S1 — lazy migration of legacy plaintext session rows", () => {
  it("upgrades the row on first authenticated load: same logical seed, encrypted column, no other state change", async () => {
    const store = new SupabaseSessionStore();
    const seed = "CASE-FOWQ1C";
    fake.tables.investigation_sessions.push(legacyRow("user-legacy", seed));
    const before = structuredClone(fake.tables.investigation_sessions[0]);

    const session = (await store.getActiveSession("user-legacy"))!;

    expect(session.seed).toBe(seed);
    const after = fake.tables.investigation_sessions[0];
    expect(String(after.seed)).toMatch(/^s1e\.v1\./);
    expect(leaksSeed(JSON.stringify(after), seed)).toBe(false);
    const { seed: _a, ...restAfter } = after;
    const { seed: _b, ...restBefore } = before;
    void _a;
    void _b;
    expect(restAfter).toEqual(restBefore); // evidence, notes, time, updated_at… untouched
    expect(fake.writes).toEqual([{ table: "investigation_sessions", op: "update", payload: { seed: after.seed } }]);
    expect(fake.tables.generated_assets).toHaveLength(0);

    const { generatedAt: _g1, ...truthNow } = generateCase(session.seed, { difficulty: "investigator" });
    const { generatedAt: _g2, ...truthBefore } = generateCase(seed, { difficulty: "investigator" });
    void _g1;
    void _g2;
    expect(truthNow).toEqual(truthBefore); // historical generation byte-identical, no new case
  });

  it("is idempotent: later loads read the envelope and never rewrite it", async () => {
    const store = new SupabaseSessionStore();
    fake.tables.investigation_sessions.push(legacyRow("user-idem", "CASE-Q7YKPN"));
    await store.getActiveSession("user-idem");
    const envelope = fake.tables.investigation_sessions[0].seed;
    const writes = fake.writes.length;

    for (let i = 0; i < 3; i++) expect((await store.getActiveSession("user-idem"))!.seed).toBe("CASE-Q7YKPN");
    expect(fake.tables.investigation_sessions[0].seed).toBe(envelope);
    expect(fake.writes.length).toBe(writes);
  });

  it("concurrent first loads converge on one envelope of the same seed", async () => {
    const store = new SupabaseSessionStore();
    fake.tables.investigation_sessions.push(legacyRow("user-race", "CASE-YKS1GG"));
    const [a, b] = await Promise.all([store.getActiveSession("user-race"), store.getActiveSession("user-race")]);
    expect(a!.seed).toBe("CASE-YKS1GG");
    expect(b!.seed).toBe("CASE-YKS1GG");
    expect((await store.getActiveSession("user-race"))!.seed).toBe("CASE-YKS1GG");
    expect(String(fake.tables.investigation_sessions[0].seed)).toMatch(/^s1e\.v1\./);
  });

  it("a failed upgrade never breaks the load; the next load or save completes it", async () => {
    const store = new SupabaseSessionStore();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    fake.tables.investigation_sessions.push(legacyRow("user-retry", "CASE-52WGII"));
    fake.failNext.set("investigation_sessions:update", 1);

    const first = (await store.getActiveSession("user-retry"))!;
    expect(first.seed).toBe("CASE-52WGII");
    expect(fake.tables.investigation_sessions[0].seed).toBe("CASE-52WGII");

    await store.saveSession("user-retry", first); // a save always seals
    expect(String(fake.tables.investigation_sessions[0].seed)).toMatch(/^s1e\.v1\./);
    expect((await store.getActiveSession("user-retry"))!.seed).toBe("CASE-52WGII");
  });
});

describe("S1 — Generated Art keyed by caseRef", () => {
  it("a new asset's row, storage path and signed URL carry the caseRef and never the seed", async () => {
    const seed = generateCaseSeed();
    const { caseRef, lookupKeys } = caseAssetKeysFor(seed);
    const result = await getOrGenerateAsset(
      { store: assetStore, provider: new MockGeneratedAssetProvider() },
      {
        userId: "user-art",
        caseRef,
        caseLookupKeys: lookupKeys,
        assetKind: "character_portrait",
        descriptorHash: "hash-new",
        generationVersion: 1,
        providerName: "mock",
        promptVersion: 1,
        prompt: "p",
        seed: "avatar-seed",
      },
    );

    expect(result.status).toBe("ready");
    const row = fake.tables.generated_assets[0];
    expect(row.case_seed).toBe(caseRef);
    expect(String(row.storage_path).startsWith(`user-art/${caseRef}/hash-new.`)).toBe(true);
    expect([...fake.objects.keys()]).toEqual([row.storage_path]);
    expect(signedUrlLeaksSeed(result.url!, seed)).toBe(false);
    expect(leaksSeed(JSON.stringify(fake.tables.generated_assets), seed)).toBe(false);
  });

  it("refuses to write any row or object keyed by a plaintext seed", async () => {
    await expect(assetStore.createQueuedRecord("u", "CASE-8J2X91", "character_portrait", "h", 1, "mock", null)).rejects.toThrow(/caseRef/);
    await expect(assetStore.uploadAssetBytes("u", "CASE-8J2X91", "h", new Uint8Array(), "image/png")).rejects.toThrow(/caseRef/);
    expect(fake.tables.generated_assets).toHaveLength(0);
    expect(fake.objects.size).toBe(0);
  });
});

describe("S1 — lazy migration of a legacy case's Generated Art", () => {
  function seedLegacyArt(userId: string, seed: string) {
    const truth = generateCase(seed, { difficulty: "investigator" });
    const people = importantPeopleForPortraits(truth).slice(0, 3);
    people.forEach((person, i) => {
      const hash = hashDescriptor(buildCharacterVisualDescriptor(person));
      const path = `${userId}/${seed}/${hash}.png`;
      fake.objects.set(path, "bytes");
      fake.tables.generated_assets.push({
        id: `legacy-${i}`,
        user_id: userId,
        case_seed: seed,
        asset_kind: "character_portrait",
        descriptor_hash: hash,
        generation_version: CHARACTER_PORTRAIT_GENERATION_VERSION,
        provider: ACTIVE_PROVIDER_NAME,
        status: "ready",
        storage_path: path,
        source_asset_id: null,
      });
    });
    // A reuse row in this case pointing at an OLDER archived case's object.
    fake.objects.set(`${userId}/CASE-OLDOLD/old.png`, "bytes");
    fake.tables.generated_assets.push({
      id: "legacy-reused",
      user_id: userId,
      case_seed: seed,
      asset_kind: "crime_scene_environment",
      descriptor_hash: "scene-hash",
      generation_version: 1,
      provider: ACTIVE_PROVIDER_NAME,
      status: "ready",
      storage_path: `${userId}/CASE-OLDOLD/old.png`,
      source_asset_id: "archived-canonical",
    });
    fake.tables.investigation_sessions.push(legacyRow(userId, seed));
    return { truth, people };
  }

  it("before migration the legacy signed URLs leak the seed; after the first load none do, and every image still resolves", async () => {
    const userId = "user-legacy-art";
    const seed = "CASE-DG83V3";
    const { truth, people } = seedLegacyArt(userId, seed);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const beforeUrls = await getReadyPortraitUrls(userId, truth);
    expect(beforeUrls.size).toBe(people.length);
    expect([...beforeUrls.values()].every((url) => signedUrlLeaksSeed(url, seed))).toBe(true);

    await new SupabaseSessionStore().getActiveSession(userId);

    const caseRef = computeCaseRef(seed);
    expect([...fake.objects.keys()].filter((p) => p.includes(seed))).toEqual([]);
    expect(fake.tables.generated_assets.every((r) => r.case_seed === caseRef)).toBe(true);
    expect(leaksSeed(JSON.stringify(fake.tables.generated_assets), seed)).toBe(false);
    expect(fake.tables.generated_assets.find((r) => r.id === "legacy-reused")!.storage_path).toBe(`${userId}/CASE-OLDOLD/old.png`);
    expect(fake.objects.size).toBe(people.length + 1); // moved, never deleted

    const afterUrls = await getReadyPortraitUrls(userId, truth);
    expect(afterUrls.size).toBe(people.length);
    for (const url of afterUrls.values()) {
      expect(signedUrlLeaksSeed(url, seed)).toBe(false);
      expect(url).toContain(caseRef);
    }
  });

  it("is crash-safe and idempotent: a failed move leaves that asset on the legacy key and a later load finishes it", async () => {
    const userId = "user-legacy-art-retry";
    const seed = "CASE-67P3IE";
    const { truth, people } = seedLegacyArt(userId, seed);
    vi.spyOn(console, "log").mockImplementation(() => {});
    const failing = String(fake.tables.generated_assets[0].storage_path);
    fake.failMoves.add(failing);

    const store = new SupabaseSessionStore();
    await store.getActiveSession(userId);
    expect(fake.tables.generated_assets[0].case_seed).toBe(seed); // untouched, still readable
    expect((await getReadyPortraitUrls(userId, truth)).size).toBe(people.length);

    fake.failMoves.clear();
    await store.getActiveSession(userId);
    expect(leaksSeed(JSON.stringify(fake.tables.generated_assets), seed)).toBe(false);
    expect([...fake.objects.keys()].some((p) => p.includes(seed))).toBe(false);

    const opsBefore = fake.storageOps.length;
    const writesBefore = fake.writes.length;
    await store.getActiveSession(userId);
    expect(fake.storageOps.length).toBe(opsBefore);
    expect(fake.writes.length).toBe(writesBefore);
  });
});

describe("S1 — reconstruction and archived cases unchanged", () => {
  const accusation = { culpritId: "person_x", motiveType: "money", method: "m", accomplices: [], submittedAt: 900 };

  it("an encrypted active session with an accusation still releases its reconstruction, with no seed in the payload", async () => {
    currentUserId = "user-recon";
    const seed = generateCaseSeed();
    const store = new SupabaseSessionStore();
    const session = await store.createSession(currentUserId, seed, "investigator", 480);
    session.accusation = accusation;
    await store.saveSession(currentUserId, session);

    const release = await getActiveCaseReconstruction();
    expect(release.available).toBe(true);
    expect(leaksSeed(JSON.stringify(release), seed)).toBe(false);
  });

  it("archived legacy and strong-format cases (plaintext case_history) still regenerate their reconstruction", async () => {
    currentUserId = "user-archive";
    for (const seed of ["CASE-DG83V3", generateCaseSeed()]) {
      const id = `hist-${seed}`;
      fake.tables.case_history.push({ id, user_id: currentUserId, seed, difficulty: "investigator", accusation, score: {}, completed_at: "2026-09-02T00:00:00Z" });
      const release = await getArchivedCaseReconstruction(id);
      expect(release.available).toBe(true);
    }
  });
});
