import { describe, expect, it } from "vitest";
import { describePhoneRequest, requestPhoneRecords } from "../phone-records";
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
    surveillance: {},
    board: { nodes: [], edges: [] },
    accusation: null,
    crimeSceneExamined: false,
    crimeSceneInspectedZoneIds: [],
    lastRevealedEvidenceIds: [],
    lastActionMessage: null,
    ...overrides,
  };
}

describe("requestPhoneRecords / describePhoneRequest", () => {
  it("a request creates a scheduled event", () => {
    const session = makeSession({ currentTime: 200 });
    requestPhoneRecords(session, "suspect1");
    expect(session.events).toHaveLength(1);
    expect(session.events[0].type).toBe("phone_records");
    expect(session.events[0].status).toBe("scheduled");
    expect(session.events[0].scheduledAt).toBe(200 + EVENT_DELAY_MINUTES.phone_records);
  });

  it("reports not_requested before any request, pending before scheduledAt, ready after", () => {
    const session = makeSession({ currentTime: 0 });
    expect(describePhoneRequest(session, "suspect1").status).toBe("not_requested");

    requestPhoneRecords(session, "suspect1");
    expect(describePhoneRequest(session, "suspect1").status).toBe("pending");

    session.currentTime = EVENT_DELAY_MINUTES.phone_records - 1;
    resolveEvents(session);
    expect(describePhoneRequest(session, "suspect1").status).toBe("pending");

    session.currentTime += 1;
    resolveEvents(session);
    expect(describePhoneRequest(session, "suspect1").status).toBe("ready");
  });

  it("the notification payload never leaks a suspicious call, contact, location match, or any conclusion", () => {
    const session = makeSession({ currentTime: 0 });
    requestPhoneRecords(session, "suspect1");
    const event = session.events[0];
    const text = `${event.payload.title} ${event.payload.detail}`.toLowerCase();
    for (const forbidden of ["suspect", "appel", "call", "contact", "localis", "location", "incrimin", "coupable", "culprit"]) {
      expect(text).not.toContain(forbidden);
    }
    expect(event.payload.title).toBe("TÉLÉPHONIE — Relevés disponibles");
  });

  it("the same person cannot schedule twice — a second request reuses the same event", () => {
    const session = makeSession({ currentTime: 0 });
    requestPhoneRecords(session, "suspect1");
    const first = session.events[0];
    requestPhoneRecords(session, "suspect1");
    expect(session.events).toHaveLength(1);
    expect(session.events[0]).toBe(first);
  });

  it("uses the identical delay regardless of whether the records will eventually be incriminating or not", () => {
    const sessionA = makeSession({ currentTime: 0 });
    const sessionB = makeSession({ currentTime: 0 });
    requestPhoneRecords(sessionA, "culprit-in-this-story");
    requestPhoneRecords(sessionB, "innocent-bystander");
    expect(sessionA.events[0].scheduledAt).toBe(sessionB.events[0].scheduledAt);
  });
});
