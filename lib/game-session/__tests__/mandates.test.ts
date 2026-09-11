import { describe, expect, it } from "vitest";
import { describeMandateEvent, evaluateBankRecordsRequest, requestMandateWithDelay } from "../mandates";
import { EVENT_DELAY_MINUTES, resolveEvents } from "../events";
import type { GameSession } from "../types";
import type { CaseTruth } from "@/lib/game-engine/types/case";
import type { Evidence } from "@/lib/game-engine/types/evidence";

function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: "ev1",
    family: "financial",
    type: "bank_transfer",
    sourceEventId: null,
    sourceLocationId: null,
    relatedPersonIds: ["suspect1"],
    relatedLocationIds: [],
    timestamp: 0,
    discoverableAt: 0,
    discoveryDifficulty: 0,
    reliability: "reliable",
    requiresLabAnalysis: null,
    isRedHerring: false,
    status: "discovered",
    description: "Virement suspect.",
    ...overrides,
  };
}

function makeTruth(evidence: Evidence[]): CaseTruth {
  return {
    seed: "CASE-TEST01",
    difficulty: "investigator",
    crimeType: "homicide",
    archetype: "crime_of_opportunity",
    generatedAt: new Date().toISOString(),
    locations: [],
    people: [],
    relationships: [],
    victimId: "victim",
    culpritId: "victim",
    accompliceIds: [],
    accomplices: [],
    suspectIds: [],
    motive: { type: "revenge", holderId: "victim", targetId: "victim", description: "", strength: 0, groundingRelationshipIds: [] },
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
    evidence,
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
    victimPhone: { ownerPersonId: "victim", contacts: [], conversations: [], calls: [] },
  };
}

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

describe("requestMandateWithDelay — bank", () => {
  it("is genuinely pending right after requesting — never reveals granted/denied immediately", () => {
    const truth = makeTruth([makeEvidence()]);
    const session = makeSession({ currentTime: 0, evidenceStatus: { ev1: "discovered" } }); // would be GRANTED once ready

    const outcome = requestMandateWithDelay(truth, session, "bank", "suspect1");
    expect(outcome.status).toBe("pending");
  });

  it("becomes available only after enough game time has actually passed", () => {
    const truth = makeTruth([makeEvidence()]);
    const session = makeSession({ currentTime: 0, evidenceStatus: { ev1: "discovered" } });
    requestMandateWithDelay(truth, session, "bank", "suspect1");

    session.currentTime = EVENT_DELAY_MINUTES.bank_warrant - 1;
    resolveEvents(session);
    expect(describeMandateEvent(session, "bank", "suspect1").status).toBe("pending");

    session.currentTime = EVENT_DELAY_MINUTES.bank_warrant;
    resolveEvents(session);
    expect(describeMandateEvent(session, "bank", "suspect1").status).toBe("granted");
  });

  it("granted and denied bank decisions use the identical delay — timing cannot leak the outcome", () => {
    const grantedSession = makeSession({ evidenceStatus: { ev1: "discovered" } });
    const deniedSession = makeSession({ evidenceStatus: {} }); // nothing discovered -> denied

    requestMandateWithDelay(makeTruth([makeEvidence()]), grantedSession, "bank", "suspect1");
    requestMandateWithDelay(makeTruth([makeEvidence()]), deniedSession, "bank", "suspect1");

    const grantedEvent = grantedSession.events[0];
    const deniedEvent = deniedSession.events[0];
    expect(grantedEvent.scheduledAt).toBe(deniedEvent.scheduledAt);
    expect(grantedEvent.type).toBe(deniedEvent.type);
    expect(grantedEvent.payload).toEqual(deniedEvent.payload); // identical wording either way

    grantedSession.currentTime = EVENT_DELAY_MINUTES.bank_warrant;
    deniedSession.currentTime = EVENT_DELAY_MINUTES.bank_warrant;
    resolveEvents(grantedSession);
    resolveEvents(deniedSession);
    expect(describeMandateEvent(grantedSession, "bank", "suspect1").status).toBe("granted");
    expect(describeMandateEvent(deniedSession, "bank", "suspect1").status).toBe("denied");
  });

  it("re-requesting the same mandate never resets the delay (idempotent)", () => {
    const truth = makeTruth([makeEvidence()]);
    const session = makeSession({ currentTime: 0, evidenceStatus: { ev1: "discovered" } });
    requestMandateWithDelay(truth, session, "bank", "suspect1");
    const firstScheduledAt = session.events[0].scheduledAt;

    session.currentTime = 10;
    requestMandateWithDelay(truth, session, "bank", "suspect1");
    expect(session.events).toHaveLength(1);
    expect(session.events[0].scheduledAt).toBe(firstScheduledAt);
  });
});

describe("requestMandateWithDelay — search warrant", () => {
  it("is genuinely pending right after requesting", () => {
    const truth = makeTruth([makeEvidence()]);
    const session = makeSession({ evidenceStatus: { ev1: "discovered" } });
    expect(requestMandateWithDelay(truth, session, "search", "suspect1").status).toBe("pending");
  });

  it("granted and denied search warrants use the identical delay", () => {
    const grantedSession = makeSession({ evidenceStatus: { ev1: "discovered" } });
    const deniedSession = makeSession({ evidenceStatus: {} });
    requestMandateWithDelay(makeTruth([makeEvidence()]), grantedSession, "search", "suspect1");
    requestMandateWithDelay(makeTruth([makeEvidence()]), deniedSession, "search", "suspect1");
    expect(grantedSession.events[0].scheduledAt).toBe(deniedSession.events[0].scheduledAt);
    expect(grantedSession.events[0].scheduledAt).toBe(EVENT_DELAY_MINUTES.search_warrant);
  });

  it("becoming ready does NOT execute the search — no evidence status changes just from resolving the event", () => {
    const truth = makeTruth([makeEvidence({ family: "physical", type: "weapon", relatedLocationIds: ["home1"] })]);
    const session = makeSession({ currentTime: 0, evidenceStatus: { ev1: "discovered" } });
    requestMandateWithDelay(truth, session, "search", "suspect1");

    session.currentTime = EVENT_DELAY_MINUTES.search_warrant;
    resolveEvents(session);
    expect(describeMandateEvent(session, "search", "suspect1").status).toBe("granted");
    // Nothing about resolving the event itself touched evidence — execution
    // is a deliberate, separate player action (executeSearchWarrantAction).
    expect(session.evidenceStatus.ev1).toBe("discovered");
    expect(session.crimeSceneInspectedZoneIds).toEqual([]);
  });

  it("the notification payload never contains a granted/denied conclusion", () => {
    const truth = makeTruth([makeEvidence()]);
    const session = makeSession({ evidenceStatus: { ev1: "discovered" } });
    requestMandateWithDelay(truth, session, "search", "suspect1");
    const event = session.events[0];
    expect(event.payload.title.toLowerCase()).not.toContain("accord");
    expect(event.payload.title.toLowerCase()).not.toContain("refus");
    expect(event.payload.detail.toLowerCase()).not.toContain("accord");
    expect(event.payload.detail.toLowerCase()).not.toContain("refus");
  });
});

describe("evaluateBankRecordsRequest", () => {
  it("stays pending_records until its own separate delay elapses, after the warrant is granted", () => {
    const truth = makeTruth([makeEvidence()]);
    const session = makeSession({ currentTime: 0, evidenceStatus: { ev1: "discovered" } });
    requestMandateWithDelay(truth, session, "bank", "suspect1");
    session.currentTime = EVENT_DELAY_MINUTES.bank_warrant;
    resolveEvents(session);

    const firstCall = evaluateBankRecordsRequest(session, "suspect1");
    expect(firstCall.status).toBe("pending_records");

    session.currentTime += EVENT_DELAY_MINUTES.bank_records - 1;
    resolveEvents(session);
    expect(evaluateBankRecordsRequest(session, "suspect1").status).toBe("pending_records");

    session.currentTime += 1;
    resolveEvents(session);
    expect(evaluateBankRecordsRequest(session, "suspect1").status).toBe("ready");
  });

  it("reports no_mandate when nothing has been requested, and denied without ever scheduling records", () => {
    const session = makeSession();
    expect(evaluateBankRecordsRequest(session, "suspect1").status).toBe("no_mandate");

    const deniedSession = makeSession({ evidenceStatus: {} });
    requestMandateWithDelay(makeTruth([makeEvidence()]), deniedSession, "bank", "suspect1");
    deniedSession.currentTime = EVENT_DELAY_MINUTES.bank_warrant;
    resolveEvents(deniedSession);
    expect(evaluateBankRecordsRequest(deniedSession, "suspect1").status).toBe("denied");
    expect(deniedSession.events.some((e) => e.type === "bank_records")).toBe(false);
  });
});

// ---------------------------------------------------------------------
// Hardening regression tests — mandate decision leakage (Living
// Investigation System, Phase 1 hardening pass). These specifically
// exercise describeMandateEvent(), the one sanctioned safe projection of
// a mandate's player-facing state, rather than MandateRecord.granted
// directly — exactly the boundary the eslint no-restricted-syntax rule
// in eslint.config.mjs now also enforces statically.
// ---------------------------------------------------------------------

describe("mandate decision leakage hardening", () => {
  it("before scheduledAt, a granted and a refused mandate are indistinguishable from the player-facing API", () => {
    const grantedSession = makeSession({ currentTime: 0, evidenceStatus: { ev1: "discovered" } }); // will resolve granted
    const deniedSession = makeSession({ currentTime: 0, evidenceStatus: {} }); // will resolve denied

    for (const kind of ["bank", "search"] as const) {
      const grantedOutcome = requestMandateWithDelay(makeTruth([makeEvidence()]), grantedSession, kind, "suspect1");
      const deniedOutcome = requestMandateWithDelay(makeTruth([makeEvidence()]), deniedSession, kind, "suspect1");

      // Identical status AND identical wording — nothing about the
      // player-facing response differs between the two outcomes yet.
      expect(grantedOutcome).toEqual({ status: "pending", reason: "Décision en attente." });
      expect(deniedOutcome).toEqual({ status: "pending", reason: "Décision en attente." });
      expect(grantedOutcome).toEqual(deniedOutcome);

      // Re-checking via the safe projection independently of the request
      // call itself still agrees — not just the immediate return value.
      expect(describeMandateEvent(grantedSession, kind, "suspect1")).toEqual(describeMandateEvent(deniedSession, kind, "suspect1"));
    }
  });

  it("after scheduledAt, the correct decision becomes visible through the same safe projection", () => {
    const grantedSession = makeSession({ currentTime: 0, evidenceStatus: { ev1: "discovered" } });
    const deniedSession = makeSession({ currentTime: 0, evidenceStatus: {} });
    requestMandateWithDelay(makeTruth([makeEvidence()]), grantedSession, "search", "suspect1");
    requestMandateWithDelay(makeTruth([makeEvidence()]), deniedSession, "search", "suspect1");

    grantedSession.currentTime = EVENT_DELAY_MINUTES.search_warrant;
    deniedSession.currentTime = EVENT_DELAY_MINUTES.search_warrant;
    resolveEvents(grantedSession);
    resolveEvents(deniedSession);

    expect(describeMandateEvent(grantedSession, "search", "suspect1").status).toBe("granted");
    expect(describeMandateEvent(deniedSession, "search", "suspect1").status).toBe("denied");
  });

  it("executing a search warrant is impossible before its decision event is ready — the exact guard executeSearchWarrantAction relies on", () => {
    const truth = makeTruth([makeEvidence()]);
    const session = makeSession({ currentTime: 0, evidenceStatus: { ev1: "discovered" } }); // would resolve granted
    requestMandateWithDelay(truth, session, "search", "suspect1");

    // Still within the delay window — the safe projection must never
    // report "granted" yet, which is the only status that would let
    // executeSearchWarrantAction proceed past its `!== "granted"` guard.
    session.currentTime = EVENT_DELAY_MINUTES.search_warrant - 1;
    resolveEvents(session);
    expect(describeMandateEvent(session, "search", "suspect1").status).not.toBe("granted");

    session.currentTime += 1;
    resolveEvents(session);
    expect(describeMandateEvent(session, "search", "suspect1").status).toBe("granted"); // only now would execution be allowed
  });

  it("changing culprit/hidden CaseTruth information never changes mandate scheduling behavior", () => {
    const baseTruth = makeTruth([makeEvidence()]);
    const truthWithDifferentCulprit: CaseTruth = {
      ...baseTruth,
      culpritId: "someone-else-entirely",
      accompliceIds: ["accomplice-1"],
      staging: { type: "burglary", staged: true, tellEvidenceIds: ["ev1"], description: "staged for real" },
    };

    const sessionA = makeSession({ currentTime: 0, evidenceStatus: { ev1: "discovered" } });
    const sessionB = makeSession({ currentTime: 0, evidenceStatus: { ev1: "discovered" } });
    const outcomeA = requestMandateWithDelay(baseTruth, sessionA, "bank", "suspect1");
    const outcomeB = requestMandateWithDelay(truthWithDifferentCulprit, sessionB, "bank", "suspect1");

    expect(outcomeA).toEqual(outcomeB);
    expect(sessionA.events[0].scheduledAt).toBe(sessionB.events[0].scheduledAt);
    expect(sessionA.events[0].payload).toEqual(sessionB.events[0].payload);
  });

  it("no event payload — for lab, bank warrant, bank records, or search warrant — leaks the mandate result before resolution", () => {
    const truth = makeTruth([makeEvidence()]);
    const grantedSession = makeSession({ currentTime: 0, evidenceStatus: { ev1: "discovered" } });
    requestMandateWithDelay(truth, grantedSession, "bank", "suspect1");
    requestMandateWithDelay(truth, grantedSession, "search", "suspect1");
    grantedSession.currentTime = EVENT_DELAY_MINUTES.bank_warrant;
    resolveEvents(grantedSession);
    evaluateBankRecordsRequest(grantedSession, "suspect1"); // schedules bank_records

    const forbidden = ["accord", "refus", "grant", "deni"]; // French + English conclusion words, either language
    for (const event of grantedSession.events) {
      const text = `${event.payload.title} ${event.payload.detail}`.toLowerCase();
      for (const word of forbidden) {
        expect(text).not.toContain(word);
      }
    }
  });
});
