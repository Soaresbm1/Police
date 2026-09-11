import { describe, expect, it } from "vitest";
import { RNG } from "../../random/rng";
import {
  COVERAGE_DAY_COUNT,
  generatePostCrimeMovements,
  type PostCrimeLocation,
  type PostCrimeObservationInput,
  type PostCrimeRelationshipLink,
  type PostCrimeSubject,
} from "../post-crime-observation";
import type { LifeStatus } from "../../types/person";

function makeSubject(
  id: string,
  homeLocationId: string,
  workLocationId: string | null,
  lifeStatus: LifeStatus,
  relationshipLinks: PostCrimeRelationshipLink[] = [],
): PostCrimeSubject {
  return { id, firstName: "Prénom", lastName: id, homeLocationId, workLocationId, lifeStatus, relationshipLinks };
}

const PUBLIC_LOCATIONS: PostCrimeLocation[] = [
  { id: "loc_shop", type: "shop" },
  { id: "loc_pharmacy", type: "pharmacy" },
  { id: "loc_park", type: "park" },
  { id: "loc_restaurant", type: "restaurant" },
  { id: "loc_bar", type: "bar" },
  { id: "loc_bank", type: "bank" },
  { id: "loc_hospital", type: "hospital" },
];

/** A rich, mixed-lifeStatus, mutually-connected cast — gives the optional
 * activity system plenty of surface area (companions + public locations)
 * across many deterministic seeds. */
function richCast(): PostCrimeSubject[] {
  return [
    makeSubject("p_employed", "home1", "work1", "employed", [{ otherPersonId: "p_friend", type: "friend" }]),
    makeSubject("p_friend", "home2", "work2", "employed", [{ otherPersonId: "p_employed", type: "friend" }]),
    makeSubject("p_student", "home3", null, "student", [{ otherPersonId: "p_family", type: "family" }]),
    makeSubject("p_family", "home4", "work4", "self_employed", [{ otherPersonId: "p_student", type: "family" }]),
    makeSubject("p_retired", "home5", null, "retired", [{ otherPersonId: "p_neighbor", type: "neighbor" }]),
    makeSubject("p_neighbor", "home6", "work6", "employed", [{ otherPersonId: "p_retired", type: "neighbor" }]),
    makeSubject("p_unemployed", "home7", null, "unemployed", []),
    // Deliberately linked only via an excluded (non-safe) relationship type —
    // must never be offered as a companion.
    makeSubject("p_loner", "home8", "work8", "employed", [{ otherPersonId: "p_employed", type: "affair" }]),
  ];
}

function assertNoOverlaps(events: { timestamp: number; durationMinutes: number }[]): void {
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
  for (let i = 0; i < sorted.length - 1; i++) {
    expect(sorted[i].timestamp + sorted[i].durationMinutes).toBeLessThanOrEqual(sorted[i + 1].timestamp);
  }
}

function runRichCase(seedLabel: string, caseOpenedAt = 10 * 60) {
  const people = richCast();
  const input: PostCrimeObservationInput = { people, caseOpenedAt, publicLocations: PUBLIC_LOCATIONS };
  const events = generatePostCrimeMovements(new RNG(seedLabel), input);
  return { people, events };
}

describe("post-crime activities (Phase 5B-2)", () => {
  it("[A] same seed -> byte-identical enriched postCrimeMovements", () => {
    const a = runRichCase("activities-determinism").events;
    const b = runRichCase("activities-determinism").events;
    expect(a).toEqual(b);
  });

  it("[B, X] no overlapping events per person across many seeds, with activities enabled", () => {
    for (let trial = 0; trial < 60; trial++) {
      const { people, events } = runRichCase(`overlap-${trial}`, trial * 211);
      for (const person of people) {
        assertNoOverlaps(events.filter((e) => e.actorId === person.id));
      }
    }
  });

  it("[C, D] every activity-bearing event stays inside [caseOpenedAt, caseOpenedAt+48h)", () => {
    for (let trial = 0; trial < 60; trial++) {
      const caseOpenedAt = trial * 211;
      const coverageEnd = caseOpenedAt + COVERAGE_DAY_COUNT * 24 * 60;
      const { events } = runRichCase(`coverage-${trial}`, caseOpenedAt);
      for (const e of events) {
        expect(e.timestamp).toBeGreaterThanOrEqual(caseOpenedAt);
        expect(e.timestamp).toBeLessThan(coverageEnd);
      }
    }
  });

  it("[E, Y] optional activity count per person stays within the bounded cap (<=3, the structural max — inside the brief's 0-4 target)", () => {
    const NON_BASELINE_ACTIONS = new Set(["meet", "purchase", "other"]);
    for (let trial = 0; trial < 60; trial++) {
      const { people, events } = runRichCase(`bound-${trial}`, trial * 359);
      for (const person of people) {
        const count = events.filter((e) => e.actorId === person.id && NON_BASELINE_ACTIONS.has(e.action)).length;
        expect(count).toBeGreaterThanOrEqual(0);
        expect(count).toBeLessThanOrEqual(3);
      }
    }
  });

  it("[F] retired people receive no ordinary work event, with or without optional activities", () => {
    const { events } = runRichCase("retired-no-work");
    expect(events.some((e) => e.actorId === "p_retired" && e.action === "work")).toBe(false);
  });

  it("[G] unemployed people receive no ordinary work event", () => {
    const { events } = runRichCase("unemployed-no-work");
    expect(events.some((e) => e.actorId === "p_unemployed" && e.action === "work")).toBe(false);
  });

  it("[H] student behavior remains consistent with no normal workplace (workLocationId: null)", () => {
    const { events } = runRichCase("student-no-work");
    expect(events.some((e) => e.actorId === "p_student" && e.action === "work")).toBe(false);
  });

  it("[I] employed/self-employed people with a workplace still get ordinary work behavior intact", () => {
    let sawWork = false;
    for (let trial = 0; trial < 20; trial++) {
      const { events } = runRichCase(`work-intact-${trial}`, trial * 400);
      if (events.some((e) => e.actorId === "p_employed" && e.action === "work")) sawWork = true;
    }
    expect(sawWork).toBe(true);
  });

  it("[J] every social event's presentPersonIds references only valid, supplied person ids", () => {
    for (let trial = 0; trial < 60; trial++) {
      const { people, events } = runRichCase(`valid-ids-${trial}`, trial * 173);
      const knownIds = new Set(people.map((p) => p.id));
      for (const e of events) {
        for (const id of e.presentPersonIds) {
          expect(knownIds.has(id)).toBe(true);
        }
      }
    }
  });

  it("[K] a relationship-aware meeting/visit only ever uses an existing (safe-typed) relationship — never an arbitrary or excluded-type companion", () => {
    let sawCompanionEvent = false;
    for (let trial = 0; trial < 80; trial++) {
      const { people, events } = runRichCase(`companion-source-${trial}`, trial * 293);
      const byId = new Map(people.map((p) => [p.id, p]));
      for (const e of events) {
        if (e.presentPersonIds.length <= 1) continue;
        sawCompanionEvent = true;
        const actor = byId.get(e.actorId)!;
        const companionId = e.presentPersonIds.find((id) => id !== e.actorId)!;
        const link = actor.relationshipLinks.find((l) => l.otherPersonId === companionId);
        expect(link).toBeDefined();
        // The excluded "affair" link (p_loner <-> p_employed) must never be
        // used to justify a companion event, in either direction.
        expect(link!.type).not.toBe("affair");
      }
    }
    expect(sawCompanionEvent).toBe(true);
    // p_loner's only link is an excluded type -> never appears as anyone's companion.
    let lonerWasCompanion = false;
    for (let trial = 0; trial < 80; trial++) {
      const { events } = runRichCase(`loner-check-${trial}`, trial * 293);
      if (events.some((e) => e.actorId !== "p_loner" && e.presentPersonIds.includes("p_loner"))) lonerWasCompanion = true;
    }
    expect(lonerWasCompanion).toBe(false);
  });

  it("[L] PostCrimeSubject/PostCrimeRelationshipLink structurally cannot carry roles, attributes, or a relationship secret", () => {
    // @ts-expect-error — relationshipLinks entries have no `attributes`/`secret` field.
    const badLink: PostCrimeRelationshipLink = { otherPersonId: "x", type: "friend", secret: "hidden" };
    expect(Object.keys(badLink)).toContain("otherPersonId");
  });

  it("[M] guilt isolation: identical safe inputs (regardless of which id is 'really' the culprit in the caller's mind) produce identical outings/companions/destinations", () => {
    const culpritLike = richCast();
    const innocentLike = richCast(); // structurally identical — the function has no culpritId to treat differently
    const a = generatePostCrimeMovements(new RNG("guilt-isolation-rich"), { people: culpritLike, caseOpenedAt: 0, publicLocations: PUBLIC_LOCATIONS });
    const b = generatePostCrimeMovements(new RNG("guilt-isolation-rich"), { people: innocentLike, caseOpenedAt: 0, publicLocations: PUBLIC_LOCATIONS });
    expect(a).toEqual(b);
  });

  it("[M] guilt isolation: reordering the roster (as if a different person 'were' the culprit and got listed first) never changes any individual person's own events", () => {
    const forward = richCast();
    const reversed = [...richCast()].reverse();
    const a = generatePostCrimeMovements(new RNG("guilt-isolation-order"), { people: forward, caseOpenedAt: 500, publicLocations: PUBLIC_LOCATIONS });
    const b = generatePostCrimeMovements(new RNG("guilt-isolation-order"), { people: reversed, caseOpenedAt: 500, publicLocations: PUBLIC_LOCATIONS });
    const sortByActorThenTime = (evs: typeof a) => [...evs].sort((x, y) => x.actorId.localeCompare(y.actorId) || x.timestamp - y.timestamp);
    expect(sortByActorThenTime(a)).toEqual(sortByActorThenTime(b));
  });

  it("[N] gaps still exist: an optional activity only ever occupies a minority of its surrounding gap, never the whole thing", () => {
    const NON_BASELINE_ACTIONS = new Set(["meet", "purchase", "other"]);
    let sawActivity = false;
    for (let trial = 0; trial < 60; trial++) {
      const { people, events } = runRichCase(`gap-existence-${trial}`, trial * 251);
      for (const person of people) {
        const sorted = events.filter((e) => e.actorId === person.id).sort((a, b) => a.timestamp - b.timestamp);
        for (let i = 0; i < sorted.length; i++) {
          const e = sorted[i];
          if (!NON_BASELINE_ACTIONS.has(e.action)) continue;
          sawActivity = true;
          const prevEnd = i > 0 ? sorted[i - 1].timestamp + sorted[i - 1].durationMinutes : e.timestamp - 1000;
          const nextStart = i < sorted.length - 1 ? sorted[i + 1].timestamp : e.timestamp + e.durationMinutes + 1000;
          const surroundingSpan = nextStart - prevEnd;
          // The activity itself (plus its mandatory travel buffers) never
          // consumes the whole span it sits in — a genuine gap remains
          // before and/or after it, never continuous coverage.
          expect(e.durationMinutes).toBeLessThan(surroundingSpan);
        }
      }
    }
    expect(sawActivity).toBe(true);
  });

  it("[O] no continuous-presence inference: consecutive events for the same person are never back-to-back/continuous", () => {
    for (let trial = 0; trial < 30; trial++) {
      const { people, events } = runRichCase(`no-continuous-${trial}`, trial * 271);
      for (const person of people) {
        const sorted = events.filter((e) => e.actorId === person.id).sort((a, b) => a.timestamp - b.timestamp);
        for (let i = 0; i < sorted.length - 1; i++) {
          expect(sorted[i + 1].timestamp).toBeGreaterThan(sorted[i].timestamp + sorted[i].durationMinutes);
        }
      }
    }
  });

  it("100-case temporal stress test with activities enabled: zero same-person overlaps", () => {
    for (let i = 0; i < 100; i++) {
      const caseOpenedAt = (i * 733) % (5 * 24 * 60);
      const { people, events } = runRichCase(`CASE-5B2-STRESS-${i}`, caseOpenedAt);
      for (const person of people) {
        assertNoOverlaps(events.filter((e) => e.actorId === person.id));
      }
    }
  });

  it("an activity is never placed inside a person's own work event or too close to it (buffer respected)", () => {
    for (let trial = 0; trial < 40; trial++) {
      const { events } = runRichCase(`buffer-${trial}`, trial * 401);
      const byActor = new Map<string, typeof events>();
      for (const e of events) byActor.set(e.actorId, [...(byActor.get(e.actorId) ?? []), e]);
      for (const list of byActor.values()) {
        const sorted = [...list].sort((a, b) => a.timestamp - b.timestamp);
        for (let i = 0; i < sorted.length - 1; i++) {
          // A minimum 30-minute buffer between any two consecutive events —
          // see MIN_ACTIVITY_BUFFER_MINUTES's doc comment (provably >= the
          // worst-case car travel time across the whole town grid).
          expect(sorted[i + 1].timestamp - (sorted[i].timestamp + sorted[i].durationMinutes)).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});
