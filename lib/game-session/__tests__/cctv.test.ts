import { describe, expect, it } from "vitest";
import { describeCctvRequest, requestCctvFootage } from "../cctv";
import { EVENT_DELAY_MINUTES, resolveEvents } from "../events";
import type { GameSession } from "../types";

function makeSession(overrides: Partial<GameSession> = {}): GameSession {
  return {
    id: "s1",
    seed: "CASE-TEST01",
    difficulty: "investigator",
    createdAt: Date.now(),
    currentTime: 0,
    evidenceStatus: {},
    labQueue: [],
    events: [],
    notes: "",
    playerTimeline: [],
    interrogated: {},
    mandates: {},
    board: { nodes: [], edges: [] },
    accusation: null,
    crimeSceneExamined: false,
    crimeSceneInspectedZoneIds: [],
    lastRevealedEvidenceIds: [],
    lastActionMessage: null,
    ...overrides,
  };
}

describe("requestCctvFootage / describeCctvRequest", () => {
  it("a request creates a scheduled event", () => {
    const session = makeSession({ currentTime: 100 });
    requestCctvFootage(session, "loc1");
    expect(session.events).toHaveLength(1);
    expect(session.events[0].type).toBe("cctv_footage");
    expect(session.events[0].status).toBe("scheduled");
    expect(session.events[0].scheduledAt).toBe(100 + EVENT_DELAY_MINUTES.cctv_footage);
  });

  it("reports not_requested before any request, pending before scheduledAt, ready after", () => {
    const session = makeSession({ currentTime: 0 });
    expect(describeCctvRequest(session, "loc1").status).toBe("not_requested");

    requestCctvFootage(session, "loc1");
    expect(describeCctvRequest(session, "loc1").status).toBe("pending");

    session.currentTime = EVENT_DELAY_MINUTES.cctv_footage - 1;
    resolveEvents(session);
    expect(describeCctvRequest(session, "loc1").status).toBe("pending"); // still unavailable

    session.currentTime += 1;
    resolveEvents(session);
    expect(describeCctvRequest(session, "loc1").status).toBe("ready");
  });

  it("the notification payload never summarizes or mentions footage content", () => {
    const session = makeSession({ currentTime: 0 });
    requestCctvFootage(session, "loc1");
    const event = session.events[0];
    const text = `${event.payload.title} ${event.payload.detail}`.toLowerCase();
    for (const forbidden of ["suspect", "person", "véhicule", "vehicle", "personne", "présent", "identifié"]) {
      expect(text).not.toContain(forbidden);
    }
    expect(event.payload.title).toBe("VIDÉOSURVEILLANCE — Données disponibles");
  });

  it("the same location cannot schedule twice — a second request reuses the same event", () => {
    const session = makeSession({ currentTime: 0 });
    requestCctvFootage(session, "loc1");
    const first = session.events[0];
    requestCctvFootage(session, "loc1");
    expect(session.events).toHaveLength(1);
    expect(session.events[0]).toBe(first);
  });

  it("different locations schedule independent events", () => {
    const session = makeSession({ currentTime: 0 });
    requestCctvFootage(session, "loc1");
    requestCctvFootage(session, "loc2");
    expect(session.events).toHaveLength(2);
  });

  it("uses the identical delay regardless of whether the location will eventually have useful footage or not — this function has no way to know, and doesn't try to", () => {
    // requestCctvFootage never reads truth/evidence at all — the delay is
    // a pure function of EVENT_DELAY_MINUTES.cctv_footage, so "useful vs
    // empty" cannot possibly vary the timing.
    const sessionA = makeSession({ currentTime: 0 });
    const sessionB = makeSession({ currentTime: 0 });
    requestCctvFootage(sessionA, "loc-with-evidence");
    requestCctvFootage(sessionB, "loc-empty");
    expect(sessionA.events[0].scheduledAt).toBe(sessionB.events[0].scheduledAt);
  });
});
