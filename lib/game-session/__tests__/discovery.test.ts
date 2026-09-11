import { describe, expect, it } from "vitest";
import { advanceTime, sendToLab } from "../discovery";
import { findEvent, readyUnseenCount } from "../events";
import type { GameSession } from "../types";
import type { CaseTruth } from "@/lib/game-engine/types/case";
import type { Evidence } from "@/lib/game-engine/types/evidence";

function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: "ev1",
    family: "physical",
    type: "dna",
    sourceEventId: null,
    sourceLocationId: null,
    relatedPersonIds: [],
    relatedLocationIds: [],
    timestamp: 0,
    discoverableAt: 0,
    discoveryDifficulty: 0,
    reliability: "reliable",
    requiresLabAnalysis: "dna",
    isRedHerring: false,
    status: "discovered",
    description: "Échantillon prélevé sur les lieux.",
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
    evidenceStatus: { ev1: "discovered" },
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

describe("sendToLab", () => {
  it("schedules a lab_result event at exactly LabJob.readyAt", () => {
    const truth = makeTruth([makeEvidence({ requiresLabAnalysis: "dna" })]);
    const session = makeSession({ currentTime: 100 });

    sendToLab(truth, session, "ev1");

    const job = session.labQueue[0];
    const event = findEvent(session, "lab_result", { kind: "evidence", id: "ev1" });
    expect(event).toBeDefined();
    expect(event!.scheduledAt).toBe(job.readyAt);
    expect(event!.status).toBe("scheduled");
  });

  it("never reveals the result in the event payload — only that an analysis was requested", () => {
    const truth = makeTruth([makeEvidence({ requiresLabAnalysis: "toxicology", description: "SECRET: poison found, matches suspect X" })]);
    const session = makeSession();

    sendToLab(truth, session, "ev1");
    const event = findEvent(session, "lab_result", { kind: "evidence", id: "ev1" });
    expect(event!.payload.title).not.toContain("SECRET");
    expect(event!.payload.detail).not.toContain("SECRET");
    expect(event!.payload.detail).not.toContain("poison");
    expect(event!.payload.detail).not.toContain("suspect X");
  });
});

describe("advanceTime — lab still works exactly as before, plus resolves events", () => {
  it("marks the evidence analyzed once readyAt has passed (unchanged lab behavior)", () => {
    const truth = makeTruth([makeEvidence({ requiresLabAnalysis: "fingerprint" })]); // 20 min duration
    const session = makeSession({ currentTime: 0 });
    sendToLab(truth, session, "ev1");

    const partial = advanceTime(session, 10);
    expect(partial.completedEvidenceIds).toEqual([]);
    expect(session.evidenceStatus.ev1).toBe("sent_to_lab");

    const complete = advanceTime(session, 20); // total 30 >= readyAt (20)
    expect(complete.completedEvidenceIds).toEqual(["ev1"]);
    expect(session.evidenceStatus.ev1).toBe("analyzed");
  });

  it("resolves the mirror lab_result event in the same tick the LabJob itself resolves", () => {
    const truth = makeTruth([makeEvidence({ requiresLabAnalysis: "fingerprint" })]);
    const session = makeSession({ currentTime: 0 });
    sendToLab(truth, session, "ev1");

    advanceTime(session, 19);
    expect(findEvent(session, "lab_result", { kind: "evidence", id: "ev1" })?.status).toBe("scheduled");
    expect(readyUnseenCount(session)).toBe(0);

    advanceTime(session, 1); // now at 20, matches readyAt
    expect(findEvent(session, "lab_result", { kind: "evidence", id: "ev1" })?.status).toBe("ready");
    expect(readyUnseenCount(session)).toBe(1);
  });

  it("a +4H-style jump resolves several lab results at once, all correctly", () => {
    const truth = makeTruth([
      makeEvidence({ id: "ev-fast", requiresLabAnalysis: "fingerprint" }), // 20 min
      makeEvidence({ id: "ev-slow", requiresLabAnalysis: "dna" }), // 45 min
    ]);
    const session = makeSession({ currentTime: 0, evidenceStatus: { "ev-fast": "discovered", "ev-slow": "discovered" } });
    sendToLab(truth, session, "ev-fast");
    sendToLab(truth, session, "ev-slow");

    const result = advanceTime(session, 240); // +4H
    expect(result.completedEvidenceIds.sort()).toEqual(["ev-fast", "ev-slow"]);
    expect(readyUnseenCount(session)).toBe(2);
  });
});
