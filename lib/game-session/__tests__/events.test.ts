import { describe, expect, it } from "vitest";
import { findEvent, makeEventId, markEventSeen, readyUnseenCount, resolveEvents, scheduleEvent, sortedEvents, visibleEvents } from "../events";
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
    hintState: { progress: {}, history: [], totalHintsUsed: 0 },
    ...overrides,
  };
}

const PAYLOAD = { title: "LABORATOIRE — Analyse terminée", detail: "Résultat disponible." };

describe("makeEventId", () => {
  it("is deterministic — same type+source always produces the same id, no randomness", () => {
    const a = makeEventId("lab_result", { kind: "evidence", id: "ev1" });
    const b = makeEventId("lab_result", { kind: "evidence", id: "ev1" });
    expect(a).toBe(b);
  });

  it("varies with type and with source", () => {
    const a = makeEventId("lab_result", { kind: "evidence", id: "ev1" });
    const b = makeEventId("bank_warrant", { kind: "evidence", id: "ev1" });
    const c = makeEventId("lab_result", { kind: "evidence", id: "ev2" });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("scheduleEvent", () => {
  it("schedules a new event at currentTime + delay, status scheduled", () => {
    const session = makeSession({ currentTime: 100 });
    const event = scheduleEvent(session, "lab_result", { kind: "evidence", id: "ev1" }, 45, PAYLOAD);
    expect(event.status).toBe("scheduled");
    expect(event.createdAt).toBe(100);
    expect(event.scheduledAt).toBe(145);
    expect(session.events).toHaveLength(1);
  });

  it("never duplicate-schedules the same logical event — the second call returns the existing event unchanged", () => {
    const session = makeSession({ currentTime: 100 });
    const first = scheduleEvent(session, "lab_result", { kind: "evidence", id: "ev1" }, 45, PAYLOAD);
    const second = scheduleEvent(session, "lab_result", { kind: "evidence", id: "ev1" }, 999, PAYLOAD); // different delay, ignored
    expect(second).toBe(first);
    expect(second.scheduledAt).toBe(145); // NOT re-scheduled with the new delay
    expect(session.events).toHaveLength(1);
  });

  it("does not duplicate-schedule even after the event has become ready", () => {
    const session = makeSession({ currentTime: 0 });
    scheduleEvent(session, "lab_result", { kind: "evidence", id: "ev1" }, 10, PAYLOAD);
    session.currentTime = 10;
    resolveEvents(session);
    scheduleEvent(session, "lab_result", { kind: "evidence", id: "ev1" }, 10, PAYLOAD);
    expect(session.events).toHaveLength(1);
    expect(session.events[0].status).toBe("ready");
  });
});

describe("resolveEvents", () => {
  it("flips a scheduled event to ready once currentTime reaches scheduledAt, not before", () => {
    const session = makeSession({ currentTime: 0 });
    const event = scheduleEvent(session, "lab_result", { kind: "evidence", id: "ev1" }, 30, PAYLOAD);

    session.currentTime = 29;
    expect(resolveEvents(session)).toHaveLength(0);
    expect(event.status).toBe("scheduled");

    session.currentTime = 30;
    const justReady = resolveEvents(session);
    expect(justReady).toHaveLength(1);
    expect(justReady[0].id).toBe(event.id);
    expect(event.status).toBe("ready");
  });

  it("is idempotent: calling it twice at the same currentTime never fires an event twice", () => {
    const session = makeSession({ currentTime: 30 });
    scheduleEvent(session, "lab_result", { kind: "evidence", id: "ev1" }, 0, PAYLOAD);

    const first = resolveEvents(session);
    const second = resolveEvents(session);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0); // nothing left to resolve — not fired again
  });

  it("resolves every event crossed during a large time jump (simulating +4H), in stable scheduledAt order", () => {
    const session = makeSession({ currentTime: 0 });
    scheduleEvent(session, "lab_result", { kind: "evidence", id: "ev-late" }, 180, PAYLOAD);
    scheduleEvent(session, "bank_warrant", { kind: "mandate", id: "bank:p1" }, 60, PAYLOAD);
    scheduleEvent(session, "search_warrant", { kind: "mandate", id: "search:p2" }, 120, PAYLOAD);

    session.currentTime = 240; // +4H
    const justReady = resolveEvents(session);
    expect(justReady.map((e) => e.scheduledAt)).toEqual([60, 120, 180]);
    expect(session.events.every((e) => e.status === "ready")).toBe(true);
  });

  it("resolves Phase 2 event types (cctv_footage, phone_records) alongside Phase 1 ones in the same jump, deterministically", () => {
    const session = makeSession({ currentTime: 0 });
    scheduleEvent(session, "cctv_footage", { kind: "location", id: "loc1" }, 45, PAYLOAD);
    scheduleEvent(session, "phone_records", { kind: "person", id: "p1" }, 90, PAYLOAD);
    scheduleEvent(session, "lab_result", { kind: "evidence", id: "ev1" }, 30, PAYLOAD);

    session.currentTime = 240; // +4H
    const justReady = resolveEvents(session);
    expect(justReady.map((e) => e.type)).toEqual(["lab_result", "cctv_footage", "phone_records"]);
    expect(session.events.every((e) => e.status === "ready")).toBe(true);
  });

  it("keeps deterministic id tie-break ordering for two events scheduled at the exact same minute", () => {
    const session = makeSession({ currentTime: 0 });
    scheduleEvent(session, "search_warrant", { kind: "mandate", id: "search:zz" }, 30, PAYLOAD);
    scheduleEvent(session, "bank_warrant", { kind: "mandate", id: "bank:aa" }, 30, PAYLOAD);

    session.currentTime = 30;
    const justReady = resolveEvents(session);
    const ids = justReady.map((e) => e.id);
    expect(ids).toEqual([...ids].sort()); // lexicographic id order, both scheduledAt equal
  });
});

describe("markEventSeen", () => {
  it("moves a ready event to seen", () => {
    const session = makeSession({ currentTime: 10 });
    const event = scheduleEvent(session, "lab_result", { kind: "evidence", id: "ev1" }, 0, PAYLOAD);
    resolveEvents(session);
    markEventSeen(session, event.id);
    expect(findEvent(session, "lab_result", { kind: "evidence", id: "ev1" })?.status).toBe("seen");
  });

  it("does nothing to a still-scheduled event — only ready events can become seen", () => {
    const session = makeSession({ currentTime: 0 });
    const event = scheduleEvent(session, "lab_result", { kind: "evidence", id: "ev1" }, 100, PAYLOAD);
    markEventSeen(session, event.id);
    expect(event.status).toBe("scheduled");
  });

  it("does nothing for an unknown event id (no crash)", () => {
    const session = makeSession();
    expect(() => markEventSeen(session, "does-not-exist")).not.toThrow();
  });
});

describe("readyUnseenCount / visibleEvents", () => {
  it("counts only ready events, never scheduled ones — the player must never know something is coming", () => {
    const session = makeSession({ currentTime: 0 });
    scheduleEvent(session, "lab_result", { kind: "evidence", id: "ev-ready" }, 0, PAYLOAD);
    scheduleEvent(session, "bank_warrant", { kind: "mandate", id: "bank:p1" }, 500, PAYLOAD); // stays scheduled
    resolveEvents(session);

    expect(readyUnseenCount(session)).toBe(1);
    expect(visibleEvents(session)).toHaveLength(1); // the scheduled one never appears
  });

  it("stops counting a seen event as unread", () => {
    const session = makeSession({ currentTime: 0 });
    const event = scheduleEvent(session, "lab_result", { kind: "evidence", id: "ev1" }, 0, PAYLOAD);
    resolveEvents(session);
    expect(readyUnseenCount(session)).toBe(1);

    markEventSeen(session, event.id);
    expect(readyUnseenCount(session)).toBe(0);
    expect(visibleEvents(session)).toHaveLength(1); // still visible in the inbox, just not counted as unread
  });
});

describe("determinism across independent sessions", () => {
  it("the same sequence of scheduling calls on two independent sessions produces the identical event schedule", () => {
    const run = () => {
      const session = makeSession({ currentTime: 0 });
      scheduleEvent(session, "lab_result", { kind: "evidence", id: "ev1" }, 45, PAYLOAD);
      session.currentTime = 60;
      scheduleEvent(session, "bank_warrant", { kind: "mandate", id: "bank:p1" }, 60, PAYLOAD);
      resolveEvents(session);
      return sortedEvents(session).map((e) => ({ id: e.id, scheduledAt: e.scheduledAt, status: e.status }));
    };
    expect(run()).toEqual(run());
  });
});
