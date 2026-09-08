import { describe, expect, it } from "vitest";
import { validateCase } from "../validator/case-validator";
import type { CaseTruth } from "../types/case";
import type { Person } from "../types/person";
import type { Location } from "../types/location";
import type { TimelineEvent } from "../types/timeline";

function makePerson(id: string, homeLocationId: string): Person {
  return {
    id,
    firstName: "Test",
    lastName: id,
    age: 30,
    sex: "male",
    profession: "test",
    homeLocationId,
    workLocationId: null,
    avatarSeed: id,
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
  };
}

function makeLocation(id: string, x: number, y: number): Location {
  return {
    id,
    name: id,
    type: "apartment",
    address: "",
    district: "Centre",
    coordinates: { x, y },
    hasCameras: false,
    cameraZones: [],
    hasWifi: false,
    wifiSsid: null,
    hasBadgeAccess: false,
    openingHours: null,
    employeePersonIds: [],
    residentPersonIds: [],
  };
}

function makeEvent(overrides: Partial<TimelineEvent> & Pick<TimelineEvent, "id" | "timestamp" | "actorId" | "locationId">): TimelineEvent {
  return {
    durationMinutes: 10,
    action: "other",
    description: "",
    presentPersonIds: [overrides.actorId],
    counterpartyId: null,
    involvedObject: null,
    observable: true,
    evidenceSourceTags: [],
    isCrimeEvent: false,
    ...overrides,
  };
}

function baseCase(): CaseTruth {
  const locA = makeLocation("locA", 0, 0);
  const locB = makeLocation("locB", 50, 50); // far away: ~70km apart
  const victim = makePerson("victim", locA.id);
  const culprit = makePerson("culprit", locB.id);

  const attackEvent = makeEvent({
    id: "evt-attack",
    timestamp: 1000,
    actorId: culprit.id,
    locationId: locA.id,
    action: "attack",
    isCrimeEvent: true,
    presentPersonIds: [culprit.id, victim.id],
    counterpartyId: victim.id,
  });

  return {
    seed: "CASE-TEST01",
    difficulty: "investigator",
    crimeType: "homicide",
    generatedAt: new Date().toISOString(),
    locations: [locA, locB],
    people: [victim, culprit],
    relationships: [],
    victimId: victim.id,
    culpritId: culprit.id,
    accompliceIds: [],
    suspectIds: [culprit.id],
    motive: {
      type: "revenge",
      holderId: culprit.id,
      targetId: victim.id,
      description: "test motive",
      strength: 0.8,
      groundingRelationshipIds: [],
    },
    method: "test",
    weapon: "test",
    crimeLocationId: locA.id,
    crimeTimestamp: 1000,
    premeditated: false,
    timeline: [attackEvent],
    evidence: [
      {
        id: "ev-physical",
        family: "physical",
        type: "dna",
        sourceEventId: attackEvent.id,
        sourceLocationId: locA.id,
        relatedPersonIds: [culprit.id],
        relatedLocationIds: [locA.id],
        timestamp: 1000,
        discoverableAt: 1010,
        discoveryDifficulty: 0.2,
        reliability: "reliable",
        requiresLabAnalysis: "dna",
        isRedHerring: false,
        status: "undiscovered",
        description: "dna trace",
      },
      {
        id: "ev-digital",
        family: "digital",
        type: "geolocation_log",
        sourceEventId: attackEvent.id,
        sourceLocationId: locA.id,
        relatedPersonIds: [culprit.id],
        relatedLocationIds: [locA.id],
        timestamp: 1000,
        discoverableAt: 1010,
        discoveryDifficulty: 0.2,
        reliability: "reliable",
        requiresLabAnalysis: null,
        isRedHerring: false,
        status: "undiscovered",
        description: "geolocation",
      },
    ],
    knowledge: [],
    testimony: [
      { id: "t1", personId: culprit.id, aboutFactId: "n/a", stance: "lie", statement: "j'étais ailleurs", motiveForStance: "auto-protection" },
    ],
    alibis: [
      {
        personId: culprit.id,
        claim: "j'étais chez moi",
        isTrue: false,
        windowStart: 950,
        windowEnd: 1050,
        claimedLocationId: locB.id,
        corroboratingEvidenceIds: [],
        contradictingEvidenceIds: ["ev-digital"],
      },
    ],
    autopsy: {
      estimatedDeathWindowStart: 980,
      estimatedDeathWindowEnd: 1020,
      causeOfDeath: "test",
      weaponType: "test",
      wounds: [],
      substancesFound: [],
      bodyPosition: "test",
      notableFeatures: [],
    },
    redHerringPersonIds: [],
  };
}

describe("validateCase", () => {
  it("accepts a minimal but internally consistent case", () => {
    const result = validateCase(baseCase());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("flags a culprit teleporting between two distant locations", () => {
    const truth = baseCase();
    // Culprit has two non-overlapping stationary events, 70km apart, only
    // 10 minutes apart in time — nowhere near enough to travel between them.
    truth.timeline.push(
      makeEvent({
        id: "evt-elsewhere",
        timestamp: 990,
        durationMinutes: 1,
        actorId: truth.culpritId,
        locationId: "locB",
        action: "work",
      }),
    );
    const result = validateCase(truth);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Téléportation"))).toBe(true);
  });

  it("flags a person claiming to have directly observed an event they weren't present at", () => {
    const truth = baseCase();
    truth.knowledge.push({
      id: "fact-impossible",
      personId: "someone-else",
      aboutEventId: "evt-attack",
      trueStatement: "a vu l'attaque",
      source: { kind: "direct_observation" },
      learnedAt: 1000,
      perceptionQuality: 0.8,
      memoryQuality: 0.8,
      confidence: 0.8,
      isCorrupted: false,
      believedStatement: "a vu l'attaque",
    });
    const result = validateCase(truth);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("impossible"))).toBe(true);
  });

  it("flags a fact learned before its source event happened", () => {
    const truth = baseCase();
    truth.knowledge.push({
      id: "fact-early",
      personId: truth.culpritId,
      aboutEventId: "evt-attack",
      trueStatement: "a commis l'attaque",
      source: { kind: "direct_observation" },
      learnedAt: 500, // before the event's own timestamp (1000)
      perceptionQuality: 0.8,
      memoryQuality: 0.8,
      confidence: 0.8,
      isCorrupted: false,
      believedStatement: "a commis l'attaque",
    });
    const result = validateCase(truth);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("avant qu'il ne se produise"))).toBe(true);
  });

  it("rejects a case with insufficient independent evidence channels", () => {
    const truth = baseCase();
    truth.evidence = [];
    truth.testimony = [];
    truth.alibis[0].contradictingEvidenceIds = [];
    truth.motive.strength = 0;
    const result = validateCase(truth);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("insuffisamment solvable"))).toBe(true);
  });
});
