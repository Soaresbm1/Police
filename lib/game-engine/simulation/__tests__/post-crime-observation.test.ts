import { describe, expect, it } from "vitest";
import { RNG } from "../../random/rng";
import { COVERAGE_DAY_COUNT, generatePostCrimeMovements, type PostCrimeRelationshipLink, type PostCrimeSubject } from "../post-crime-observation";
import type { LifeStatus } from "../../types/person";

function makeSubject(
  id: string,
  homeLocationId: string,
  workLocationId: string | null = null,
  lifeStatus: LifeStatus = "employed",
  relationshipLinks: PostCrimeRelationshipLink[] = [],
): PostCrimeSubject {
  return { id, firstName: "Test", lastName: id, homeLocationId, workLocationId, lifeStatus, relationshipLinks };
}

/** Reusable invariant assertion: for one person's events, sorted by time,
 * no two intervals may overlap — `previous.timestamp + previous.duration
 * <= next.timestamp`. A gap is fine; an overlap is not. */
function assertNoOverlaps(events: { timestamp: number; durationMinutes: number }[]): void {
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
  for (let i = 0; i < sorted.length - 1; i++) {
    const prev = sorted[i];
    const next = sorted[i + 1];
    expect(prev.timestamp + prev.durationMinutes).toBeLessThanOrEqual(next.timestamp);
  }
}

describe("generatePostCrimeMovements", () => {
  it("[1] coverage begins at caseOpenedAt itself, not the following midnight", () => {
    // caseOpenedAt mid-afternoon: if coverage started at next midnight,
    // nothing at all would be eligible until then. Instead we expect
    // same-day events (e.g. that evening's sleep) to already qualify.
    const caseOpenedAt = 14 * 60; // 14:00
    const events = generatePostCrimeMovements(new RNG("coverage-start-test"), {
      people: [makeSubject("p1", "home1", "work1")],
      caseOpenedAt,
    });
    expect(events.some((e) => e.timestamp < caseOpenedAt + 24 * 60)).toBe(true);
  });

  it("[2] same-calendar-day activity after caseOpenedAt is eligible (the 08:00-16:00 work / 23:00 sleep example)", () => {
    // caseOpenedAt at 10:30 — any event that *started* before 10:30 (e.g. an
    // ordinary morning wake/commute/work start) must be omitted, but a
    // same-day event starting after 10:30 (e.g. an evening sleep) must not
    // be pushed out to the next day.
    const caseOpenedAt = 10 * 60 + 30;
    let sawSameDayEventAfterBoundary = false;
    for (let trial = 0; trial < 50; trial++) {
      const events = generatePostCrimeMovements(new RNG(`same-day-test-${trial}`), {
        people: [makeSubject("p1", "home1", "work1")],
        caseOpenedAt,
      });
      if (events.some((e) => e.timestamp >= caseOpenedAt && e.timestamp < caseOpenedAt + 20 * 60)) {
        sawSameDayEventAfterBoundary = true;
        break;
      }
    }
    expect(sawSameDayEventAfterBoundary).toBe(true);
  });

  it("[3] no generated event begins before caseOpenedAt", () => {
    for (const caseOpenedAt of [0, 5, 600, 630, 1439, 1440, 2000, 50_000]) {
      const events = generatePostCrimeMovements(new RNG(`before-boundary-${caseOpenedAt}`), {
        people: [makeSubject("p1", "home1", "work1"), makeSubject("p2", "home2", null)],
        caseOpenedAt,
      });
      for (const e of events) {
        expect(e.timestamp).toBeGreaterThanOrEqual(caseOpenedAt);
      }
    }
  });

  it("[4] no event begins at/after coverageEnd (caseOpenedAt + 48h)", () => {
    for (const caseOpenedAt of [0, 5, 600, 630, 1439, 1440, 2000, 50_000]) {
      const coverageEnd = caseOpenedAt + COVERAGE_DAY_COUNT * 24 * 60;
      const events = generatePostCrimeMovements(new RNG(`after-boundary-${caseOpenedAt}`), {
        people: [makeSubject("p1", "home1", "work1"), makeSubject("p2", "home2", null)],
        caseOpenedAt,
      });
      for (const e of events) {
        expect(e.timestamp).toBeLessThan(coverageEnd);
      }
    }
  });

  it("[5] never contains overlapping events for the same person, across many seeds and caseOpenedAt values", () => {
    const people = [makeSubject("p1", "home1", "work1"), makeSubject("p2", "home2", null)];
    for (let trial = 0; trial < 100; trial++) {
      const caseOpenedAt = trial * 137; // spread across many times-of-day
      const events = generatePostCrimeMovements(new RNG(`overlap-stress-${trial}`), { people, caseOpenedAt });
      for (const person of people) {
        assertNoOverlaps(events.filter((e) => e.actorId === person.id));
      }
    }
  });

  it("[6] is deterministic: identical rng seed + input produce byte-identical output", () => {
    const people = [makeSubject("p1", "home1", "work1"), makeSubject("p2", "home2", null)];
    const input = { people, caseOpenedAt: 5000 };
    const a = generatePostCrimeMovements(new RNG("determinism-stream"), input);
    const b = generatePostCrimeMovements(new RNG("determinism-stream"), input);
    expect(a).toEqual(b);
  });

  it("[7] leaves honest gaps: never invents a filler event, and consecutive events for a person are never back-to-back/continuous", () => {
    const events = generatePostCrimeMovements(new RNG("gap-honesty-test"), {
      people: [makeSubject("p1", "home1", "work1")],
      caseOpenedAt: 0,
    });
    const actions = new Set(events.map((e) => e.action));
    expect(actions).toEqual(new Set(["wake_up", "work", "sleep"]));
    const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
    for (let i = 0; i < sorted.length - 1; i++) {
      expect(sorted[i + 1].timestamp).toBeGreaterThan(sorted[i].timestamp + sorted[i].durationMinutes);
    }
  });

  it("its input type structurally cannot carry roles, personality, or other hidden-role data", () => {
    // @ts-expect-error — PostCrimeSubject has no `roles` field; this must
    // remain a compile error, so the generator can never even theoretically
    // branch on hidden role/culprit information.
    const bad: PostCrimeSubject = { id: "p1", firstName: "A", lastName: "B", homeLocationId: "h1", workLocationId: null, lifeStatus: "employed", relationshipLinks: [], roles: ["culprit"] };
    expect(Object.keys(bad)).toContain("id");
  });

  it("two subjects with identical public fields produce identical events regardless of which one is 'really' the culprit", () => {
    const culpritLike = makeSubject("shared-id", "home1", "work1");
    const innocentLike = makeSubject("shared-id", "home1", "work1");
    const a = generatePostCrimeMovements(new RNG("guilt-isolation"), { people: [culpritLike], caseOpenedAt: 0 });
    const b = generatePostCrimeMovements(new RNG("guilt-isolation"), { people: [innocentLike], caseOpenedAt: 0 });
    expect(a).toEqual(b);
  });

  it("every event references one of the supplied subjects and one of that subject's own locations — never an unknown id", () => {
    const people = [makeSubject("p1", "home1", "work1"), makeSubject("p2", "home2", null)];
    const events = generatePostCrimeMovements(new RNG("integrity-test"), { people, caseOpenedAt: 0 });
    const byId = new Map(people.map((p) => [p.id, p]));
    for (const e of events) {
      const person = byId.get(e.actorId);
      expect(person).toBeDefined();
      const validLocations = new Set([person!.homeLocationId, person!.workLocationId].filter((id): id is string => Boolean(id)));
      expect(validLocations.has(e.locationId)).toBe(true);
      expect(e.presentPersonIds).toEqual([e.actorId]);
      expect(e.counterpartyId).toBeNull();
      expect(e.isCrimeEvent).toBe(false);
    }
  });

  it("100-case temporal stress test: zero same-person overlaps across many deterministic cases", () => {
    const people = [makeSubject("stress-p1", "home1", "work1"), makeSubject("stress-p2", "home2", null)];
    for (let i = 0; i < 100; i++) {
      const caseOpenedAt = (i * 733) % (5 * 24 * 60); // varied times-of-day, deterministic per iteration
      const events = generatePostCrimeMovements(new RNG(`CASE-STRESS-${i}`), { people, caseOpenedAt });
      for (const person of people) {
        assertNoOverlaps(events.filter((e) => e.actorId === person.id));
      }
    }
  });
});
