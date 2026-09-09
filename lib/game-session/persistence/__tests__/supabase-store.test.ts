import { describe, expect, it, vi } from "vitest";

// rowToSession never touches Supabase itself (it's a pure row -> GameSession
// mapper), but the module it lives in also exports a class that does — mock
// @/lib/supabase/server the same way identity.test.ts does, so importing
// this file never requires a real Next.js request context.
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({}),
}));

import { rowToSession, type SessionRow } from "../supabase-store";

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
    board: { nodes: [], edges: [] },
    accusation: null,
    crime_scene_examined: true,
    crime_scene_inspected_zone_ids: ["zone1"],
    last_action_message: null,
    last_revealed_evidence_ids: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
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
