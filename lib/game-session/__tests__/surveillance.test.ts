import { describe, expect, it } from "vitest";
import {
  checkPersonEligibility,
  checkSurveillanceRequest,
  coverageWindow,
  describeSurveillance,
  isSurveillanceDuration,
  parseSurveillanceKey,
  projectSurveillanceObservations,
  startSurveillance,
  surveillanceKey,
  SURVEILLANCE_DURATIONS_MINUTES,
} from "../surveillance";
import { resolveEvents } from "../events";
import type { GameSession } from "../types";
import type { CaseTruth } from "@/lib/game-engine/types/case";
import type { Person } from "@/lib/game-engine/types/person";
import type { TimelineEvent } from "@/lib/game-engine/types/timeline";

function makePerson(overrides: Partial<Person> = {}): Person {
  return {
    id: "person_1",
    firstName: "Antoine",
    lastName: "Fontana",
    age: 40,
    sex: "male",
    lifeStatus: "employed",
    profession: "comptable",
    homeLocationId: "loc_home",
    workLocationId: "loc_work",
    avatarSeed: "seed",
    personality: {
      intelligence: 0.5,
      impulsivity: 0.5,
      sociability: 0.5,
      aggressiveness: 0.5,
      honesty: 0.5,
      loyalty: 0.5,
      fearfulness: 0.5,
    },
    baselineStress: 0.3,
    wealthChf: 50_000,
    addictions: [],
    phoneNumber: "0790000000",
    vehicle: null,
    digitalAccounts: [],
    roles: [],
    ...overrides,
  };
}

function makeMovement(overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    id: "evt_1",
    timestamp: 0,
    durationMinutes: 60,
    actorId: "person_1",
    locationId: "loc_home",
    action: "sleep",
    description: "ground truth text — never player-facing",
    presentPersonIds: ["person_1"],
    counterpartyId: null,
    involvedObject: null,
    observable: true,
    evidenceSourceTags: [],
    isCrimeEvent: false,
    ...overrides,
  };
}

const CASE_OPENED_AT = 1000;

function makeTruth(overrides: Partial<CaseTruth> = {}): CaseTruth {
  return {
    seed: "CASE-TEST01",
    difficulty: "investigator",
    crimeType: "homicide",
    archetype: "crime_of_opportunity",
    generatedAt: new Date().toISOString(),
    locations: [],
    people: [makePerson(), makePerson({ id: "victim", firstName: "Julie", lastName: "Morel" })],
    relationships: [],
    victimId: "victim",
    culpritId: "person_1",
    accompliceIds: [],
    accomplices: [],
    suspectIds: ["person_1"],
    motive: { type: "revenge", holderId: "person_1", targetId: "victim", description: "", strength: 0, groundingRelationshipIds: [] },
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
    evidence: [],
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
    caseOpenedAt: CASE_OPENED_AT,
    postCrimeMovements: [],
    victimPhone: { ownerPersonId: "victim", contacts: [], conversations: [], calls: [] },
    ...overrides,
  };
}

function makeSession(overrides: Partial<GameSession> = {}): GameSession {
  return {
    id: "s1",
    seed: "CASE-TEST01",
    difficulty: "investigator",
    createdAt: Date.now(),
    currentTime: CASE_OPENED_AT,
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

describe("surveillance — [A] start time / [B] duration", () => {
  it("[A] starts exactly at the current investigation clock time", () => {
    const truth = makeTruth();
    const session = makeSession({ currentTime: CASE_OPENED_AT + 500 });
    const result = startSurveillance(truth, session, "person_1", 120);
    expect(result.ok).toBe(true);
    expect(result.record?.startedAt).toBe(CASE_OPENED_AT + 500);
  });

  it("[B] the observation window is exactly the selected duration, never more or less", () => {
    for (const duration of SURVEILLANCE_DURATIONS_MINUTES) {
      const truth = makeTruth();
      const session = makeSession();
      const result = startSurveillance(truth, session, "person_1", duration);
      expect(result.record!.endedAt - result.record!.startedAt).toBe(duration);
      expect(result.record!.durationMinutes).toBe(duration);
    }
  });

  it("only the fixed duration menu is accepted, never arbitrary values", () => {
    expect(isSurveillanceDuration(120)).toBe(true);
    expect(isSurveillanceDuration(240)).toBe(true);
    expect(isSurveillanceDuration(480)).toBe(true);
    expect(isSurveillanceDuration(180)).toBe(false);
    expect(isSurveillanceDuration(60)).toBe(false);
  });
});

describe("surveillance — [C]/[D] no leaks before start or after end", () => {
  it("[C] a movement entirely before the window produces no observation", () => {
    const truth = makeTruth({
      postCrimeMovements: [makeMovement({ timestamp: CASE_OPENED_AT - 200, durationMinutes: 30 })],
    });
    const obs = projectSurveillanceObservations(truth, "person_1", CASE_OPENED_AT, CASE_OPENED_AT + 120);
    expect(obs).toEqual([]);
  });

  it("[D] a movement entirely after the window produces no observation", () => {
    const truth = makeTruth({
      postCrimeMovements: [makeMovement({ timestamp: CASE_OPENED_AT + 500, durationMinutes: 30 })],
    });
    const obs = projectSurveillanceObservations(truth, "person_1", CASE_OPENED_AT, CASE_OPENED_AT + 120);
    expect(obs).toEqual([]);
  });

  it("[C, D] no returned observation ever falls outside [windowStart, windowEnd)", () => {
    const truth = makeTruth({
      postCrimeMovements: [
        makeMovement({ id: "e1", timestamp: CASE_OPENED_AT - 100, durationMinutes: 400 }),
        makeMovement({ id: "e2", timestamp: CASE_OPENED_AT + 50, durationMinutes: 30 }),
        makeMovement({ id: "e3", timestamp: CASE_OPENED_AT + 300, durationMinutes: 600 }),
      ],
    });
    const start = CASE_OPENED_AT;
    const end = CASE_OPENED_AT + 240;
    const obs = projectSurveillanceObservations(truth, "person_1", start, end);
    for (const o of obs) {
      expect(o.observedFrom).toBeGreaterThanOrEqual(start);
      expect(o.observedUntil).toBeLessThanOrEqual(end);
    }
  });
});

describe("surveillance — [E]/[F] partial-overlap clipping", () => {
  it("[E] a movement already in progress at window start is clipped to the window's own start, and classified 'departed' (arrival not witnessed)", () => {
    // movement 13:00-15:00 (CASE_OPENED_AT relative: -60 to +60), surveillance starts at CASE_OPENED_AT
    const truth = makeTruth({
      postCrimeMovements: [makeMovement({ timestamp: CASE_OPENED_AT - 60, durationMinutes: 120, locationId: "loc_cafe" })],
    });
    const obs = projectSurveillanceObservations(truth, "person_1", CASE_OPENED_AT, CASE_OPENED_AT + 240);
    expect(obs).toHaveLength(1);
    expect(obs[0].observedFrom).toBe(CASE_OPENED_AT); // clipped to window start, never the real 13:00
    expect(obs[0].observedUntil).toBe(CASE_OPENED_AT + 60); // real departure, witnessed
    expect(obs[0].observationType).toBe("departed");
  });

  it("[F] a movement still ongoing at window end is clipped to the window's own end, and classified 'arrived' (arrival witnessed, departure not)", () => {
    // movement starts inside the window but runs past surveillance end.
    const truth = makeTruth({
      postCrimeMovements: [makeMovement({ timestamp: CASE_OPENED_AT + 60, durationMinutes: 300, locationId: "loc_work" })],
    });
    const windowEnd = CASE_OPENED_AT + 120;
    const obs = projectSurveillanceObservations(truth, "person_1", CASE_OPENED_AT, windowEnd);
    expect(obs).toHaveLength(1);
    expect(obs[0].observedFrom).toBe(CASE_OPENED_AT + 60); // real arrival, witnessed
    expect(obs[0].observedUntil).toBe(windowEnd); // clipped to window end, never the real departure 360 later
    expect(obs[0].observationType).toBe("arrived");

    // The hidden true end (staying until timestamp+durationMinutes) is never exposed.
    expect(obs[0].observedUntil).toBeLessThan(CASE_OPENED_AT + 60 + 300);
  });

  it("a movement fully contained in the window exposes its real start and end", () => {
    const truth = makeTruth({
      postCrimeMovements: [makeMovement({ timestamp: CASE_OPENED_AT + 30, durationMinutes: 60, locationId: "loc_cafe" })],
    });
    const obs = projectSurveillanceObservations(truth, "person_1", CASE_OPENED_AT, CASE_OPENED_AT + 240);
    expect(obs).toEqual([
      { locationId: "loc_cafe", observedFrom: CASE_OPENED_AT + 30, observedUntil: CASE_OPENED_AT + 90, observationType: "arrived" },
    ]);
  });
});

describe("surveillance — [G]/[H] gaps are never interpolated", () => {
  it("[G] a gap between two movements produces exactly two observations, nothing in between", () => {
    const truth = makeTruth({
      postCrimeMovements: [
        makeMovement({ id: "e1", timestamp: CASE_OPENED_AT, durationMinutes: 60, locationId: "loc_a" }), // ends at +60
        // gap +60 .. +150
        makeMovement({ id: "e2", timestamp: CASE_OPENED_AT + 150, durationMinutes: 60, locationId: "loc_b" }),
      ],
    });
    const obs = projectSurveillanceObservations(truth, "person_1", CASE_OPENED_AT, CASE_OPENED_AT + 300);
    expect(obs).toHaveLength(2);
    expect(obs[0].locationId).toBe("loc_a");
    expect(obs[0].observedUntil).toBe(CASE_OPENED_AT + 60);
    expect(obs[1].locationId).toBe("loc_b");
    expect(obs[1].observedFrom).toBe(CASE_OPENED_AT + 150);
    // No third, fabricated observation covering the 60..150 gap.
    expect(obs.some((o) => o.observedFrom > CASE_OPENED_AT + 60 && o.observedFrom < CASE_OPENED_AT + 150 && o.locationId !== "loc_b")).toBe(false);
  });

  it("[H] no continuous presence is invented across an empty postCrimeMovements set", () => {
    const truth = makeTruth({ postCrimeMovements: [] });
    const obs = projectSurveillanceObservations(truth, "person_1", CASE_OPENED_AT, CASE_OPENED_AT + 240);
    expect(obs).toEqual([]);
  });
});

describe("surveillance — [I] coverage bounds", () => {
  it("computes the coverage window from caseOpenedAt, not from the movements themselves", () => {
    const truth = makeTruth();
    const { start, end } = coverageWindow(truth);
    expect(start).toBe(CASE_OPENED_AT);
    expect(end).toBe(CASE_OPENED_AT + 48 * 60);
  });

  it("[I] rejects a request extending past the 48h coverage window", () => {
    const truth = makeTruth();
    const session = makeSession({ currentTime: CASE_OPENED_AT + 48 * 60 - 60 }); // 1h before coverage ends
    const result = startSurveillance(truth, session, "person_1", 480); // 8h — pushes well past coverage
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("beyond_coverage");
  });

  it("[I] rejects a request starting before coverage begins", () => {
    const truth = makeTruth();
    const session = makeSession({ currentTime: CASE_OPENED_AT - 10 });
    const result = startSurveillance(truth, session, "person_1", 120);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("before_coverage");
  });

  it("accepts a request landing exactly at the coverage boundary", () => {
    const truth = makeTruth();
    const session = makeSession({ currentTime: CASE_OPENED_AT + 48 * 60 - 120 });
    const result = startSurveillance(truth, session, "person_1", 120);
    expect(result.ok).toBe(true);
  });
});

describe("surveillance — [J]/[K] eligibility", () => {
  it("[J] a known, non-victim person can be surveilled", () => {
    const truth = makeTruth();
    expect(checkPersonEligibility(truth, "person_1")).toEqual({ eligible: true, reason: null });
  });

  it("[K] an unknown person id is rejected", () => {
    const truth = makeTruth();
    expect(checkPersonEligibility(truth, "nonexistent")).toEqual({ eligible: false, reason: "unknown_person" });
  });

  it("[K] the victim cannot be surveilled", () => {
    const truth = makeTruth();
    expect(checkPersonEligibility(truth, "victim")).toEqual({ eligible: false, reason: "ineligible_person" });
  });

  it("startSurveillance itself refuses an ineligible person, never trusting a prior client-side check", () => {
    const truth = makeTruth();
    const session = makeSession();
    const result = startSurveillance(truth, session, "victim", 120);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("ineligible_person");
    expect(Object.keys(session.surveillance)).toHaveLength(0);
  });
});

describe("surveillance — [L]/[M]/[N] overlap rules", () => {
  it("[L] a second overlapping request for the same person is rejected", () => {
    const truth = makeTruth();
    const session = makeSession({ currentTime: CASE_OPENED_AT });
    const first = startSurveillance(truth, session, "person_1", 240); // [1000, 1240)
    expect(first.ok).toBe(true);

    session.currentTime = CASE_OPENED_AT + 100; // still inside the first window
    const second = startSurveillance(truth, session, "person_1", 120);
    expect(second.ok).toBe(false);
    expect(second.reason).toBe("overlapping_active");
    expect(Object.keys(session.surveillance)).toHaveLength(1);
  });

  it("[M] once a surveillance's window has elapsed, another may start for the same person", () => {
    const truth = makeTruth();
    const session = makeSession({ currentTime: CASE_OPENED_AT });
    const first = startSurveillance(truth, session, "person_1", 120); // [1000, 1120)
    expect(first.ok).toBe(true);

    session.currentTime = CASE_OPENED_AT + 120; // exactly when the first ends
    const second = startSurveillance(truth, session, "person_1", 120);
    expect(second.ok).toBe(true);
    expect(Object.keys(session.surveillance)).toHaveLength(2);
  });

  it("[N] two different people can have independent, even overlapping, surveillance windows", () => {
    const truth = makeTruth({ people: [makePerson({ id: "person_1" }), makePerson({ id: "person_2" }), makePerson({ id: "victim" })] });
    const session = makeSession({ currentTime: CASE_OPENED_AT });
    const a = startSurveillance(truth, session, "person_1", 240);
    const b = startSurveillance(truth, session, "person_2", 240);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(Object.keys(session.surveillance)).toHaveLength(2);
  });
});

describe("surveillance — [O]/[P]/[Q] asynchronous resolution", () => {
  it("[O] scheduling a surveillance request creates a scheduled InvestigationEvent, not an immediate reveal", () => {
    const truth = makeTruth();
    const session = makeSession();
    startSurveillance(truth, session, "person_1", 120);
    expect(session.events).toHaveLength(1);
    expect(session.events[0].type).toBe("surveillance_result");
    expect(session.events[0].status).toBe("scheduled");
  });

  it("[P] the result is not visible before the scheduled completion, even though it's already computed internally", () => {
    const truth = makeTruth({
      postCrimeMovements: [makeMovement({ timestamp: CASE_OPENED_AT + 10, durationMinutes: 30 })],
    });
    const session = makeSession();
    const result = startSurveillance(truth, session, "person_1", 120);
    const key = result.record!.key;

    // Internally, the computed observations already exist...
    expect(session.surveillance[key].observations.length).toBeGreaterThan(0);
    // ...but the safe accessor refuses to return them before "ready".
    const outcome = describeSurveillance(session, key);
    expect(outcome.status).toBe("pending");
    expect(outcome.record).toBeNull();
  });

  it("[Q] the result resolves once the investigation clock reaches the scheduled end", () => {
    const truth = makeTruth({
      postCrimeMovements: [makeMovement({ timestamp: CASE_OPENED_AT + 10, durationMinutes: 30 })],
    });
    const session = makeSession();
    const result = startSurveillance(truth, session, "person_1", 120);
    const key = result.record!.key;

    session.currentTime = result.record!.endedAt - 1;
    resolveEvents(session);
    expect(describeSurveillance(session, key).status).toBe("pending");

    session.currentTime = result.record!.endedAt;
    resolveEvents(session);
    const outcome = describeSurveillance(session, key);
    expect(outcome.status).toBe("ready");
    expect(outcome.record?.observations.length).toBeGreaterThan(0);
  });
});

describe("surveillance — [R]/[S] persistence round-trip", () => {
  it("[R] a pending surveillance survives a JSON serialize/deserialize round-trip (simulating a page refresh)", () => {
    const truth = makeTruth();
    const session = makeSession();
    startSurveillance(truth, session, "person_1", 120);

    const revived = JSON.parse(JSON.stringify(session)) as GameSession;
    const key = Object.keys(revived.surveillance)[0];
    expect(revived.surveillance[key]).toEqual(session.surveillance[key]);
    expect(revived.events).toEqual(session.events);
    expect(describeSurveillance(revived, key).status).toBe("pending");
  });

  it("[S] a completed (ready) surveillance survives the same round-trip, observations intact", () => {
    const truth = makeTruth({
      postCrimeMovements: [makeMovement({ timestamp: CASE_OPENED_AT + 10, durationMinutes: 30 })],
    });
    const session = makeSession();
    const result = startSurveillance(truth, session, "person_1", 120);
    session.currentTime = result.record!.endedAt;
    resolveEvents(session);

    const revived = JSON.parse(JSON.stringify(session)) as GameSession;
    const outcome = describeSurveillance(revived, result.record!.key);
    expect(outcome.status).toBe("ready");
    expect(outcome.record?.observations).toEqual(result.record!.observations);
  });
});

describe("surveillance — [T] immutability of CaseTruth", () => {
  it("[T] CaseTruth.postCrimeMovements is deep-equal before and after a surveillance request", () => {
    const movements = [makeMovement({ timestamp: CASE_OPENED_AT + 10, durationMinutes: 30 })];
    const truth = makeTruth({ postCrimeMovements: movements });
    const before = JSON.parse(JSON.stringify(truth.postCrimeMovements));
    const session = makeSession();
    startSurveillance(truth, session, "person_1", 240);
    expect(truth.postCrimeMovements).toEqual(before);
  });
});

describe("surveillance — [U] client-safe payload", () => {
  it("[U] a SurveillanceObservation carries only the four safe fields — no ground-truth timeline fields leak through", () => {
    const truth = makeTruth({
      postCrimeMovements: [
        makeMovement({
          timestamp: CASE_OPENED_AT + 10,
          durationMinutes: 30,
          description: "SECRET GROUND TRUTH — never player-facing",
          isCrimeEvent: true,
          evidenceSourceTags: ["dna", "camera"],
        }),
      ],
    });
    const obs = projectSurveillanceObservations(truth, "person_1", CASE_OPENED_AT, CASE_OPENED_AT + 240);
    expect(obs).toHaveLength(1);
    expect(Object.keys(obs[0]).sort()).toEqual(["locationId", "observationType", "observedFrom", "observedUntil"]);
  });
});

describe("surveillance — [V] determinism", () => {
  it("[V] the same inputs yield the identical projection every time", () => {
    const truth = makeTruth({
      postCrimeMovements: [
        makeMovement({ id: "e1", timestamp: CASE_OPENED_AT - 30, durationMinutes: 90, locationId: "loc_a" }),
        makeMovement({ id: "e2", timestamp: CASE_OPENED_AT + 150, durationMinutes: 60, locationId: "loc_b" }),
      ],
    });
    const a = projectSurveillanceObservations(truth, "person_1", CASE_OPENED_AT, CASE_OPENED_AT + 300);
    const b = projectSurveillanceObservations(truth, "person_1", CASE_OPENED_AT, CASE_OPENED_AT + 300);
    expect(a).toEqual(b);
  });

  it("[V] the same seed/session inputs to startSurveillance produce the identical stored record", () => {
    const truth = makeTruth({
      postCrimeMovements: [makeMovement({ timestamp: CASE_OPENED_AT + 10, durationMinutes: 30 })],
    });
    const sessionA = makeSession();
    const resultA = startSurveillance(truth, sessionA, "person_1", 240);

    const sessionB = makeSession();
    const resultB = startSurveillance(truth, sessionB, "person_1", 240);

    expect(resultA.record?.observations).toEqual(resultB.record?.observations);
  });
});

describe("surveillance — [W] life-status interaction is purely movement-driven", () => {
  it("[W] a retired person (no workLocationId, no work movements) is never observed 'at work' — nothing is invented from their status", () => {
    const retiree = makePerson({ id: "person_1", lifeStatus: "retired", workLocationId: null, profession: "retraité·e" });
    const truth = makeTruth({
      people: [retiree, makePerson({ id: "victim" })],
      // Only home movements exist — exactly what a retired person's
      // postCrimeMovements would contain (see post-crime-observation.ts).
      postCrimeMovements: [
        makeMovement({ timestamp: CASE_OPENED_AT, durationMinutes: 200, locationId: "loc_home", action: "sleep" }),
      ],
    });
    const obs = projectSurveillanceObservations(truth, "person_1", CASE_OPENED_AT, CASE_OPENED_AT + 240);
    expect(obs.every((o) => o.locationId === "loc_home")).toBe(true);
  });
});

describe("surveillance — key helpers", () => {
  it("surveillanceKey/parseSurveillanceKey round-trip", () => {
    const key = surveillanceKey("person_abc123", 4321);
    const parsed = parseSurveillanceKey(key);
    expect(parsed).toEqual({ personId: "person_abc123", startedAt: 4321 });
  });

  it("checkSurveillanceRequest never mutates session state (read-only)", () => {
    const truth = makeTruth();
    const session = makeSession();
    checkSurveillanceRequest(truth, session, "person_1", CASE_OPENED_AT, CASE_OPENED_AT + 120);
    expect(Object.keys(session.surveillance)).toHaveLength(0);
    expect(session.events).toHaveLength(0);
  });
});
