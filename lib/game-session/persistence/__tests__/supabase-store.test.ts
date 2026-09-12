import { describe, expect, it, vi } from "vitest";

// rowToSession never touches Supabase itself (it's a pure row -> GameSession
// mapper), but the module it lives in also exports a class that does — mock
// @/lib/supabase/server the same way identity.test.ts does, so importing
// this file never requires a real Next.js request context.
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({}),
}));

import { rowToSession, sessionToRow, type SessionRow } from "../supabase-store";
import { computeHintPenalty } from "../../scoring";
import type { GameSession, HintState } from "../../types";

function makeRow(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    user_id: "user-1",
    seed: "CASE-TEST01",
    difficulty: "investigator",
    current_time_minutes: 250,
    evidence_status: { ev1: "collected" },
    lab_queue: [{ evidenceId: "ev1", analysisType: "dna", submittedAt: 100, readyAt: 145 }],
    investigation_events: [],
    notes: "some player notes",
    player_timeline: [],
    interrogated: { p1: ["fact1"] },
    mandates: { "bank:p1": { key: "bank:p1", granted: true, reason: "ok", requestedAt: 10 } },
    surveillance: {},
    board: { nodes: [], edges: [] },
    accusation: null,
    crime_scene_examined: true,
    crime_scene_inspected_zone_ids: ["zone1"],
    last_action_message: null,
    last_revealed_evidence_ids: [],
    hint_state: { progress: {}, history: [], totalHintsUsed: 0 },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeSession(overrides: Partial<GameSession> = {}): GameSession {
  return {
    id: "user-1",
    seed: "CASE-TEST01",
    difficulty: "investigator",
    createdAt: Date.now(),
    currentTime: 250,
    evidenceStatus: {},
    labQueue: [],
    events: [],
    notes: "",
    playerTimeline: [],
    interrogated: {},
    mandates: {},
    surveillance: {},
    board: { nodes: [], edges: [] },
    accusation: null,
    crimeSceneExamined: false,
    crimeSceneInspectedZoneIds: [],
    lastRevealedEvidenceIds: [],
    lastActionMessage: null,
    hintState: { progress: {}, history: [], totalHintsUsed: 0 },
    ...overrides,
  };
}

describe("rowToSession — backward compatibility (req. 12)", () => {
  it("deserializes investigation_events into events: [] when the column is null (a session persisted before this migration)", () => {
    const row = makeRow({ investigation_events: null as unknown as SessionRow["investigation_events"] });
    const session = rowToSession(row);
    expect(session.events).toEqual([]);
  });

  it("deserializes a normal populated investigation_events column unchanged", () => {
    const events = [{ id: "lab_result:evidence:ev1", type: "lab_result", source: { kind: "evidence", id: "ev1" }, createdAt: 0, scheduledAt: 45, status: "ready", payload: { title: "t", detail: "d" } }];
    const row = makeRow({ investigation_events: events as unknown as SessionRow["investigation_events"] });
    const session = rowToSession(row);
    expect(session.events).toEqual(events);
  });

  it("an old row missing events does NOT lose or reset any of its other state", () => {
    const row = makeRow({ investigation_events: null as unknown as SessionRow["investigation_events"] });
    const session = rowToSession(row);

    expect(session.events).toEqual([]);
    // Everything else survives untouched.
    expect(session.currentTime).toBe(250);
    expect(session.evidenceStatus).toEqual({ ev1: "collected" });
    expect(session.labQueue).toHaveLength(1);
    expect(session.mandates["bank:p1"].granted).toBe(true);
    expect(session.board).toEqual({ nodes: [], edges: [] });
    expect(session.interrogated).toEqual({ p1: ["fact1"] });
    expect(session.crimeSceneExamined).toBe(true);
    expect(session.crimeSceneInspectedZoneIds).toEqual(["zone1"]);
    expect(session.notes).toBe("some player notes");
  });
});

describe("hint_state persistence (Motive & Digital Evidence Phase 2, migration 0006)", () => {
  it("[A] an empty HintState round-trips through the Supabase row mapping unchanged", () => {
    const empty: HintState = { progress: {}, history: [], totalHintsUsed: 0 };
    const row = sessionToRow("user-1", makeSession({ hintState: empty }));
    const session = rowToSession({ ...makeRow(), ...row } as SessionRow);
    expect(session.hintState).toEqual(empty);
  });

  it("[B, G] hint progress (including every valid level 0-3) round-trips intact", () => {
    const state: HintState = {
      progress: { "crime-scene-examine": 1, "forensic-pending-analysis": 2, "warrant-unrequested": 3, "cctv-unrequested": 0 },
      history: [],
      totalHintsUsed: 3,
    };
    const row = sessionToRow("user-1", makeSession({ hintState: state }));
    const session = rowToSession({ ...makeRow(), ...row } as SessionRow);
    expect(session.hintState.progress).toEqual(state.progress);
  });

  it("[C, H] hint history (including requestedAt timestamps) round-trips intact", () => {
    const state: HintState = {
      progress: { "financial-unexplored": 2 },
      history: [
        { hintId: "financial-unexplored", category: "financial", level: 1, text: "Certaines informations financières...", requestedAt: 120 },
        { hintId: "financial-unexplored", category: "financial", level: 2, text: "Comparez l'activité financière...", requestedAt: 340 },
      ],
      totalHintsUsed: 2,
    };
    const row = sessionToRow("user-1", makeSession({ hintState: state }));
    const session = rowToSession({ ...makeRow(), ...row } as SessionRow);
    expect(session.hintState.history).toEqual(state.history);
  });

  it("[D] totalHintsUsed round-trips intact", () => {
    const state: HintState = { progress: { a: 1 }, history: [], totalHintsUsed: 7 };
    const row = sessionToRow("user-1", makeSession({ hintState: state }));
    const session = rowToSession({ ...makeRow(), ...row } as SessionRow);
    expect(session.hintState.totalHintsUsed).toBe(7);
  });

  it("[E] a legacy row with hint_state === null loads with the empty default", () => {
    const row = makeRow({ hint_state: null as unknown as SessionRow["hint_state"] });
    const session = rowToSession(row);
    expect(session.hintState).toEqual({ progress: {}, history: [], totalHintsUsed: 0 });
  });

  it("[E] a legacy row with hint_state === {} loads with the empty default", () => {
    const row = makeRow({ hint_state: {} as SessionRow["hint_state"] });
    const session = rowToSession(row);
    expect(session.hintState).toEqual({ progress: {}, history: [], totalHintsUsed: 0 });
  });

  it("[F] malformed hint_state (wrong shapes/types) never throws and always yields a valid HintState", () => {
    const malformedValues: unknown[] = [
      null,
      undefined,
      "not an object",
      42,
      [],
      { progress: "not an object" },
      { progress: { valid: 2, invalid: 99, alsoInvalid: "two" }, history: "not an array" },
      { progress: {}, history: [{ hintId: 123, category: "financial", level: 1, text: "x", requestedAt: 0 }] },
      { progress: {}, history: [{ hintId: "x", category: "not-a-real-category", level: 1, text: "x", requestedAt: 0 }] },
      { progress: {}, history: [{ hintId: "x", category: "financial", level: 5, text: "x", requestedAt: 0 }] },
      { progress: {}, history: [{ hintId: "x", category: "financial", level: 1, text: 42, requestedAt: 0 }] },
      { progress: {}, history: [{ hintId: "x", category: "financial", level: 1, text: "x", requestedAt: "not a number" }] },
      { progress: {}, history: [null, "garbage", 5], totalHintsUsed: -1 },
      { progress: {}, history: [], totalHintsUsed: "not a number" },
    ];
    for (const malformed of malformedValues) {
      const row = makeRow({ hint_state: malformed as SessionRow["hint_state"] });
      expect(() => rowToSession(row)).not.toThrow();
      const session = rowToSession(row);
      expect(session.hintState.progress).toEqual(expect.any(Object));
      expect(Array.isArray(session.hintState.history)).toBe(true);
      expect(typeof session.hintState.totalHintsUsed).toBe("number");
      // Only the one genuinely valid entry from the mixed-validity case survives.
      if (malformed && typeof malformed === "object" && "progress" in malformed) {
        const p = (malformed as { progress?: unknown }).progress;
        if (p && typeof p === "object" && "valid" in p) {
          expect(session.hintState.progress).toEqual({ valid: 2 });
        }
      }
    }
  });

  it("[I] round-tripping hintState never perturbs any unrelated GameSession field", () => {
    const original = makeSession({
      evidenceStatus: { ev1: "analyzed" },
      currentTime: 999,
      notes: "case notes",
      hintState: { progress: { "crime-scene-examine": 2 }, history: [], totalHintsUsed: 1 },
    });
    const row = sessionToRow("user-1", original);
    const reloaded = rowToSession({ ...makeRow(), ...row } as SessionRow);
    expect(reloaded.evidenceStatus).toEqual(original.evidenceStatus);
    expect(reloaded.currentTime).toBe(original.currentTime);
    expect(reloaded.notes).toBe(original.notes);
  });

  it("[J] the hint score penalty is identical before and after a round trip", () => {
    const original = makeSession({
      hintState: { progress: { "crime-scene-examine": 2, "warrant-unrequested": 3 }, history: [], totalHintsUsed: 2 },
    });
    const penaltyBefore = computeHintPenalty(original);
    const row = sessionToRow("user-1", original);
    const reloaded = rowToSession({ ...makeRow(), ...row } as SessionRow);
    const penaltyAfter = computeHintPenalty(reloaded);
    expect(penaltyAfter).toBe(penaltyBefore);
    expect(penaltyAfter).toBe(-1 + -2);
  });
});
