import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "./fake-supabase";

/**
 * Security S2 EXPAND-2 — dedicated tests for the seed-reseal fallback path
 * (`caseline_reseal_seed`, exercised here through
 * `SupabaseSessionStore#saveSession`/`getActiveSession`, since the RPC
 * itself only exists as a local SQL draft — see
 * `s2-migration-structure.test.ts` for the structural SQL-level proofs:
 * capability-required, scoped by both user_id and session_uuid, never
 * references plaintext/decryption).
 */

const ORIGINAL_ENV = process.env;
let fake: FakeSupabase;

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => fake,
}));

let currentUserId = "user-reseal";
vi.mock("@/lib/game-session/identity", () => ({
  getCurrentIdentity: async () => ({ userId: currentUserId, authenticated: true, displayEmail: null }),
}));

import { S1_MASTER_SECRET_ENV } from "../s1-keys";
import { SupabaseSessionStore } from "@/lib/game-session/persistence/supabase-store";
import { generateCaseSeed } from "@/lib/game-engine/random/rng";

function legacyRow(userId: string, sessionUuid: string, seed: string) {
  return {
    user_id: userId,
    session_uuid: sessionUuid,
    seed,
    difficulty: "investigator",
    current_time_minutes: 100,
    evidence_status: {},
    lab_queue: [],
    investigation_events: [],
    notes: "",
    player_timeline: [],
    interrogated: {},
    mandates: {},
    surveillance: {},
    board: { nodes: [], edges: [] },
    accusation: null,
    crime_scene_examined: false,
    crime_scene_inspected_zone_ids: [],
    last_action_message: null,
    last_revealed_evidence_ids: [],
    hint_state: { progress: {}, history: [], totalHintsUsed: 0 },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

beforeEach(() => {
  fake = new FakeSupabase();
  process.env = {
    ...ORIGINAL_ENV,
    NEXT_PUBLIC_SUPABASE_URL: "https://fakeprojectref00000000.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-test-key",
    [S1_MASTER_SECRET_ENV]: randomBytes(32).toString("base64url"),
    CASELINE_S2_SERVER_CAPABILITY: randomBytes(32).toString("base64url"),
  };
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("seed reseal — legacy plaintext to s1e.v1", () => {
  it("a legacy plaintext active seed resealed on load becomes a valid s1e.v1 envelope", async () => {
    currentUserId = "user-legacy";
    const seed = "CASE-LEGACY";
    fake.tables.investigation_sessions.push(legacyRow(currentUserId, "session-legacy", seed));

    const store = new SupabaseSessionStore();
    const session = await store.getActiveSession(currentUserId);
    expect(session!.seed).toBe(seed);
    expect(String(fake.tables.investigation_sessions[0].seed)).toMatch(/^s1e\.v1\./);
  });

  it("an already-encrypted seed survives a retry save without corruption or re-encryption drift", async () => {
    currentUserId = "user-already-sealed";
    fake.currentUserId = currentUserId;
    const store = new SupabaseSessionStore();
    await store.createSession(currentUserId, generateCaseSeed(), "investigator", 480);
    const sealedOnce = fake.tables.investigation_sessions[0].seed;

    const session = (await store.getActiveSession(currentUserId))!;
    await store.saveSession(currentUserId, session);
    await store.saveSession(currentUserId, session);

    expect(fake.tables.investigation_sessions[0].seed).toBe(sealedOnce);
  });
});

describe("seed reseal — isolation and denial", () => {
  it("resealing user A's session never touches user B's row", async () => {
    fake.tables.investigation_sessions.push(legacyRow("user-a", "session-a", "CASE-AAAAAA"));
    fake.tables.investigation_sessions.push(legacyRow("user-b", "session-b", "CASE-BBBBBB"));

    currentUserId = "user-a";
    const store = new SupabaseSessionStore();
    await store.getActiveSession("user-a");

    const rowB = fake.tables.investigation_sessions.find((r) => r.user_id === "user-b")!;
    expect(rowB.seed).toBe("CASE-BBBBBB"); // untouched — still legacy plaintext
  });

  it("a session_uuid that doesn't match any row is denied (getActiveSession returns null, no write attempted)", async () => {
    currentUserId = "user-none";
    const store = new SupabaseSessionStore();
    const session = await store.getActiveSession("user-none");
    expect(session).toBeNull();
    expect(fake.writes).toHaveLength(0);
  });

  it("without CASELINE_S2_SERVER_CAPABILITY configured, the reseal fallback fails closed and never corrupts the row", async () => {
    currentUserId = "user-noconfig";
    fake.tables.investigation_sessions.push(legacyRow(currentUserId, "session-noconfig", "CASE-NOCONF"));
    delete process.env.CASELINE_S2_SERVER_CAPABILITY;

    const store = new SupabaseSessionStore();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const session = await store.getActiveSession(currentUserId);
    expect(session!.seed).toBe("CASE-NOCONF");
    // Row stays exactly as it was — a missing capability never leaves a
    // half-written or corrupted seed behind.
    expect(fake.tables.investigation_sessions[0].seed).toBe("CASE-NOCONF");
  });
});

describe("seed reseal — saveSession never writes seed directly", () => {
  it("an ordinary saveSession on an already-sealed session makes no seed-column write at all", async () => {
    currentUserId = "user-ordinary";
    fake.currentUserId = currentUserId;
    const store = new SupabaseSessionStore();
    await store.createSession(currentUserId, generateCaseSeed(), "investigator", 480);
    const session = (await store.getActiveSession(currentUserId))!;

    const writesBefore = fake.writes.length;
    session.notes = "updated";
    await store.saveSession(currentUserId, session);
    const seedWrites = fake.writes.slice(writesBefore).filter((w) => w.payload && "seed" in w.payload);
    expect(seedWrites).toHaveLength(0);
  });
});
