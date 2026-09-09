import { describe, expect, it } from "vitest";
import { generateCase } from "@/lib/game-engine/case-generator/case-truth";
import { deriveWitnessCallbacks } from "@/lib/game-engine/witness/witness-callbacks";
import type { CaseTruth } from "@/lib/game-engine/types/case";
import {
  describeWitnessCallback,
  getWitnessCallbackContent,
  markWitnessCallbackSeen,
  scheduleWitnessCallbackIfEligible,
} from "../witness-callbacks";
import { readyUnseenCount, resolveEvents, visibleEvents } from "../events";
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

/** Finds a real generated case (small, bounded seed sweep) that actually
 * has at least one predetermined witness callback, so the scheduling
 * tests below exercise the real "eligible" path rather than a synthetic
 * stand-in. Every case in this sweep is still asserted as a case that
 * MIGHT have zero — this helper only picks one that happens to have one. */
function findCaseWithCallback(): { truth: CaseTruth; personId: string } {
  for (let i = 1; i <= 60; i++) {
    const seed = `CASE-WC${String(i).padStart(4, "0")}`;
    const truth = generateCase(seed, { difficulty: "investigator" });
    const callbacks = deriveWitnessCallbacks(truth);
    if (callbacks.length > 0) return { truth, personId: callbacks[0].personId };
  }
  throw new Error("No case with an eligible witness callback found in sweep — widen the seed range");
}

function findCaseWithoutCallbackFor(personId: string): CaseTruth {
  for (let i = 1; i <= 60; i++) {
    const seed = `CASE-WN${String(i).padStart(4, "0")}`;
    const truth = generateCase(seed, { difficulty: "investigator" });
    if (!deriveWitnessCallbacks(truth).some((c) => c.personId === personId)) return truth;
  }
  throw new Error("No case without a callback for this person found in sweep");
}

describe("scheduleWitnessCallbackIfEligible / describeWitnessCallback", () => {
  it("an eligible witness gets a scheduled event; status is pending until the delay elapses, then ready", () => {
    const { truth, personId } = findCaseWithCallback();
    const candidate = deriveWitnessCallbacks(truth).find((c) => c.personId === personId)!;
    const session = makeSession({ currentTime: 100 });

    expect(describeWitnessCallback(session, personId).status).toBe("none");

    scheduleWitnessCallbackIfEligible(truth, session, personId);
    expect(session.events).toHaveLength(1);
    expect(session.events[0].type).toBe("witness_callback");
    expect(describeWitnessCallback(session, personId).status).toBe("pending");

    session.currentTime = 100 + candidate.delayMinutes - 1;
    resolveEvents(session);
    expect(describeWitnessCallback(session, personId).status).toBe("pending");

    session.currentTime += 1;
    resolveEvents(session);
    expect(describeWitnessCallback(session, personId).status).toBe("ready");
  });

  it("a witness with no eligible candidate never gets an event scheduled, and stays 'none' forever", () => {
    const { personId } = findCaseWithCallback();
    const otherTruth = findCaseWithoutCallbackFor(personId);
    const session = makeSession({ currentTime: 0 });

    scheduleWitnessCallbackIfEligible(otherTruth, session, personId);
    expect(session.events).toHaveLength(0);
    expect(describeWitnessCallback(session, personId).status).toBe("none");

    session.currentTime = 100_000;
    resolveEvents(session);
    expect(describeWitnessCallback(session, personId).status).toBe("none");
  });

  it("re-scheduling the same witness is idempotent — no duplicate event, delay unchanged", () => {
    const { truth, personId } = findCaseWithCallback();
    const session = makeSession({ currentTime: 0 });
    scheduleWitnessCallbackIfEligible(truth, session, personId);
    const first = session.events[0];
    scheduleWitnessCallbackIfEligible(truth, session, personId);
    expect(session.events).toHaveLength(1);
    expect(session.events[0]).toBe(first);
  });

  it("the notification payload never names the witness or hints at callback content", () => {
    const { truth, personId } = findCaseWithCallback();
    const session = makeSession({ currentTime: 0 });
    scheduleWitnessCallbackIfEligible(truth, session, personId);
    const event = session.events[0];
    const person = truth.people.find((p) => p.id === personId)!;
    const text = `${event.payload.title} ${event.payload.detail}`.toLowerCase();
    expect(text).not.toContain(person.firstName.toLowerCase());
    expect(text).not.toContain(person.lastName.toLowerCase());
    for (const forbidden of ["voiture", "vehicule", "vehicle", "coupable", "culprit", "mensonge", "corrig"]) {
      expect(text).not.toContain(forbidden);
    }
    expect(event.payload.title).toBe("TÉMOIN — Nouveau contact");
  });
});

describe("getWitnessCallbackContent", () => {
  it("returns null before the event exists, and null while merely pending", () => {
    const { truth, personId } = findCaseWithCallback();
    const session = makeSession({ currentTime: 0 });
    expect(getWitnessCallbackContent(truth, session, personId)).toBeNull();

    scheduleWitnessCallbackIfEligible(truth, session, personId);
    expect(getWitnessCallbackContent(truth, session, personId)).toBeNull();
  });

  it("reveals the exact predetermined content once ready, matching the underlying KnowledgeFact", () => {
    const { truth, personId } = findCaseWithCallback();
    const candidate = deriveWitnessCallbacks(truth).find((c) => c.personId === personId)!;
    const session = makeSession({ currentTime: 0 });
    scheduleWitnessCallbackIfEligible(truth, session, personId);
    session.currentTime = candidate.delayMinutes;
    resolveEvents(session);

    const view = getWitnessCallbackContent(truth, session, personId);
    expect(view).not.toBeNull();
    expect(view!.content).toBe(candidate.content);
    expect(view!.kind).toBe(candidate.kind);
    expect(view!.status).toBe("ready");
  });

  it("discovering unrelated evidence, or advancing time without reaching the delay, never alters or reveals the content early", () => {
    const { truth, personId } = findCaseWithCallback();
    const candidate = deriveWitnessCallbacks(truth).find((c) => c.personId === personId)!;
    const session = makeSession({ currentTime: 0, evidenceStatus: { "some-evidence": "collected" } });
    scheduleWitnessCallbackIfEligible(truth, session, personId);
    session.currentTime = candidate.delayMinutes - 1;
    resolveEvents(session);
    expect(getWitnessCallbackContent(truth, session, personId)).toBeNull();
  });
});

describe("callback candidate/schedule is independent of player investigation state", () => {
  it("an active accusation against someone else does not change the callback content or its scheduled delay", () => {
    const { truth, personId } = findCaseWithCallback();
    const candidate = deriveWitnessCallbacks(truth).find((c) => c.personId === personId)!;
    const otherSuspect = truth.suspectIds.find((id) => id !== personId) ?? truth.suspectIds[0];

    const plainSession = makeSession({ currentTime: 0 });
    scheduleWitnessCallbackIfEligible(truth, plainSession, personId);

    const accusingSession = makeSession({
      currentTime: 0,
      accusation: { culpritId: otherSuspect, motiveType: "greed", method: "poison", accomplices: [], submittedAt: 0 },
    });
    scheduleWitnessCallbackIfEligible(truth, accusingSession, personId);

    expect(accusingSession.events[0].scheduledAt).toBe(plainSession.events[0].scheduledAt);
    expect(candidate.delayMinutes).toBe(accusingSession.events[0].scheduledAt - accusingSession.events[0].createdAt);
  });
});

describe("markWitnessCallbackSeen", () => {
  it("moves a ready callback to seen, and it cannot be un-consumed by reading it again", () => {
    const { truth, personId } = findCaseWithCallback();
    const candidate = deriveWitnessCallbacks(truth).find((c) => c.personId === personId)!;
    const session = makeSession({ currentTime: 0 });
    scheduleWitnessCallbackIfEligible(truth, session, personId);
    session.currentTime = candidate.delayMinutes;
    resolveEvents(session);

    markWitnessCallbackSeen(session, personId);
    expect(describeWitnessCallback(session, personId).status).toBe("seen");

    // Reload/refresh simulation: re-deriving and re-reading must still show "seen".
    markWitnessCallbackSeen(session, personId);
    expect(describeWitnessCallback(session, personId).status).toBe("seen");
    expect(getWitnessCallbackContent(truth, session, personId)!.status).toBe("seen");
  });

  it("does nothing for a witness with no scheduled event (no crash)", () => {
    const session = makeSession();
    expect(() => markWitnessCallbackSeen(session, "nobody")).not.toThrow();
  });
});

describe("consumption lifecycle: ready -> viewed -> seen -> persisted", () => {
  it("a ready callback counts as unread (Activity badge) and its content is already readable before it's marked seen", () => {
    const { truth, personId } = findCaseWithCallback();
    const candidate = deriveWitnessCallbacks(truth).find((c) => c.personId === personId)!;
    const session = makeSession({ currentTime: 0 });
    scheduleWitnessCallbackIfEligible(truth, session, personId);
    session.currentTime = candidate.delayMinutes;
    resolveEvents(session);

    // Mirrors the desired flow: "event ready -> Activity notification
    // appears" (readyUnseenCount/visibleEvents are exactly what the
    // TopBar badge and inbox read) "-> player opens the interrogation
    // page -> callback content is displayed" (already readable here,
    // strictly before any mark-seen call).
    expect(readyUnseenCount(session)).toBe(1);
    expect(visibleEvents(session).some((e) => e.type === "witness_callback")).toBe(true);
    expect(getWitnessCallbackContent(truth, session, personId)!.content).toBe(candidate.content);
  });

  it("opening the interrogation page (simulated by the same call the page's view-tracker makes) marks the callback seen and clears the unread badge, without touching its content", () => {
    const { truth, personId } = findCaseWithCallback();
    const candidate = deriveWitnessCallbacks(truth).find((c) => c.personId === personId)!;
    const session = makeSession({ currentTime: 0 });
    scheduleWitnessCallbackIfEligible(truth, session, personId);
    session.currentTime = candidate.delayMinutes;
    resolveEvents(session);
    expect(readyUnseenCount(session)).toBe(1);

    markWitnessCallbackSeen(session, personId);

    expect(describeWitnessCallback(session, personId).status).toBe("seen");
    expect(readyUnseenCount(session)).toBe(0); // no longer treated as "new"
    expect(visibleEvents(session).some((e) => e.type === "witness_callback")).toBe(true); // still in the record
    expect(getWitnessCallbackContent(truth, session, personId)!.content).toBe(candidate.content); // content unchanged
  });

  it("a reload (re-reading the same persisted session state) keeps the callback seen and its content intact — it never reverts to unread", () => {
    const { truth, personId } = findCaseWithCallback();
    const candidate = deriveWitnessCallbacks(truth).find((c) => c.personId === personId)!;
    const session = makeSession({ currentTime: 0 });
    scheduleWitnessCallbackIfEligible(truth, session, personId);
    session.currentTime = candidate.delayMinutes;
    resolveEvents(session);
    markWitnessCallbackSeen(session, personId);

    // "Reload" = nothing more than reading the same GameSession again —
    // there is no separate consumed-ids list to also persist; the event's
    // own `status` field, already part of the existing persisted
    // `events` array, is the sole source of truth.
    for (let i = 0; i < 3; i++) {
      expect(describeWitnessCallback(session, personId).status).toBe("seen");
      expect(getWitnessCallbackContent(truth, session, personId)!.content).toBe(candidate.content);
      expect(readyUnseenCount(session)).toBe(0);
    }
  });

  it("a seen callback cannot become unread again, even if resolveEvents or another schedule attempt runs afterward", () => {
    const { truth, personId } = findCaseWithCallback();
    const candidate = deriveWitnessCallbacks(truth).find((c) => c.personId === personId)!;
    const session = makeSession({ currentTime: 0 });
    scheduleWitnessCallbackIfEligible(truth, session, personId);
    session.currentTime = candidate.delayMinutes;
    resolveEvents(session);
    markWitnessCallbackSeen(session, personId);

    session.currentTime += 10_000;
    resolveEvents(session);
    scheduleWitnessCallbackIfEligible(truth, session, personId); // re-interview attempt, still idempotent

    expect(describeWitnessCallback(session, personId).status).toBe("seen");
    expect(readyUnseenCount(session)).toBe(0);
  });
});
