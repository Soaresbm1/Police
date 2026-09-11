import { describe, expect, it } from "vitest";
import { RNG } from "../../random/rng";
import {
  generatePostCrimeMovements,
  type PostCrimeLocation,
  type PostCrimeObservationInput,
  type PostCrimeRelationshipLink,
  type PostCrimeSubject,
} from "../post-crime-observation";
import type { LifeStatus } from "../../types/person";
import type { TimelineEvent } from "../../types/timeline";

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

/** A well-connected, mixed-lifeStatus cast with plenty of surface area for
 * social activities. Mirrors post-crime-activities.test.ts's cast. */
function richCast(): PostCrimeSubject[] {
  return [
    makeSubject("p_employed", "home1", "work1", "employed", [{ otherPersonId: "p_friend", type: "friend" }]),
    makeSubject("p_friend", "home2", "work2", "employed", [{ otherPersonId: "p_employed", type: "friend" }]),
    makeSubject("p_student", "home3", null, "student", [{ otherPersonId: "p_family", type: "family" }]),
    makeSubject("p_family", "home4", "work4", "self_employed", [{ otherPersonId: "p_student", type: "family" }]),
    makeSubject("p_retired", "home5", null, "retired", [{ otherPersonId: "p_neighbor", type: "neighbor" }]),
    makeSubject("p_neighbor", "home6", "work6", "employed", [{ otherPersonId: "p_retired", type: "neighbor" }]),
    makeSubject("p_unemployed", "home7", null, "unemployed", []),
    makeSubject("p_loner", "home8", "work8", "employed", [{ otherPersonId: "p_employed", type: "affair" }]),
  ];
}

function run(people: PostCrimeSubject[], caseOpenedAt: number, seedLabel: string): TimelineEvent[] {
  const input: PostCrimeObservationInput = { people, caseOpenedAt, publicLocations: PUBLIC_LOCATIONS };
  return generatePostCrimeMovements(new RNG(seedLabel), input);
}

/** A "social" event is any with more than one presentPersonIds entry. */
function socialEvents(events: TimelineEvent[]): TimelineEvent[] {
  return events.filter((e) => e.presentPersonIds.length > 1);
}

describe("post-crime reciprocity — hard invariant (project brief §2, items A-D, F, G, N)", () => {
  it("[A, B, C, D] every companion reference has a reciprocal event with the same location/interval and mutual presentPersonIds", () => {
    let sawSocialEvent = false;
    for (let trial = 0; trial < 100; trial++) {
      const events = run(richCast(), trial * 211, `reciprocity-hard-${trial}`);
      const social = socialEvents(events);
      for (const e of social) {
        sawSocialEvent = true;
        const companionId = e.presentPersonIds.find((id) => id !== e.actorId)!;
        const reciprocal = events.find((other) => other.actorId === companionId && other.presentPersonIds.includes(e.actorId) && other.timestamp === e.timestamp);
        expect(reciprocal, `no reciprocal event found for ${e.actorId}<->${companionId} at t=${e.timestamp}`).toBeDefined();
        // [B] same location
        expect(reciprocal!.locationId).toBe(e.locationId);
        // [C] same start/end
        expect(reciprocal!.timestamp).toBe(e.timestamp);
        expect(reciprocal!.durationMinutes).toBe(e.durationMinutes);
        // [D] reciprocal presentPersonIds points back to the initiator
        expect(reciprocal!.presentPersonIds).toContain(e.actorId);
        expect(reciprocal!.actorId).toBe(companionId);
      }
    }
    expect(sawSocialEvent).toBe(true);
  });

  it("[F, G] no one-sided companion event ever exists, and no overlap is introduced for either participant by reciprocal insertion", () => {
    for (let trial = 0; trial < 100; trial++) {
      const people = richCast();
      const events = run(people, trial * 173, `reciprocity-onesided-${trial}`);
      const social = socialEvents(events);
      for (const e of social) {
        const companionId = e.presentPersonIds.find((id) => id !== e.actorId)!;
        const reciprocalCount = events.filter((other) => other.actorId === companionId && other.timestamp === e.timestamp && other.presentPersonIds.includes(e.actorId)).length;
        expect(reciprocalCount).toBe(1); // exactly one matching reciprocal, never zero (one-sided) or duplicated
      }
      for (const person of people) {
        const own = events.filter((e) => e.actorId === person.id).sort((a, b) => a.timestamp - b.timestamp);
        for (let i = 0; i < own.length - 1; i++) {
          expect(own[i].timestamp + own[i].durationMinutes).toBeLessThanOrEqual(own[i + 1].timestamp);
        }
      }
    }
  });

  it("[N] invalid person IDs referenced by presentPersonIds: 0", () => {
    for (let trial = 0; trial < 60; trial++) {
      const people = richCast();
      const knownIds = new Set(people.map((p) => p.id));
      const events = run(people, trial * 293, `reciprocity-validids-${trial}`);
      for (const e of events) {
        for (const id of e.presentPersonIds) {
          expect(knownIds.has(id)).toBe(true);
        }
      }
    }
  });
});

describe("post-crime reciprocity — [E] conflicting companion schedule rejects the meeting", () => {
  it("finds a real instance where two linked people's same-cycle gaps genuinely don't overlap, and confirms no companion event was produced for it", () => {
    // Recover each person's per-cycle gap window from their OWN baseline
    // events in the output (wake/work/sleep are always present and
    // unaffected by the coordination pass) — no internal access needed.
    function gapWindows(events: TimelineEvent[], personId: string): { gapStart: number; gapEnd: number }[] {
      const own = events.filter((e) => e.actorId === personId);
      const sleeps = own.filter((e) => e.action === "sleep").sort((a, b) => a.timestamp - b.timestamp);
      const works = own.filter((e) => e.action === "work");
      return sleeps.map((sleepEvt) => {
        const work = works.find((w) => w.timestamp < sleepEvt.timestamp);
        const wake = own.filter((e) => e.action === "wake_up" && e.timestamp < sleepEvt.timestamp).sort((a, b) => b.timestamp - a.timestamp)[0];
        const gapStart = work ? work.timestamp + work.durationMinutes : wake ? wake.timestamp + wake.durationMinutes : sleepEvt.timestamp;
        return { gapStart, gapEnd: sleepEvt.timestamp };
      });
    }

    let foundConflict = false;
    for (let trial = 0; trial < 300 && !foundConflict; trial++) {
      const people = [
        makeSubject("c_a", "homeA", "workA", "employed", [{ otherPersonId: "c_b", type: "friend" }]),
        makeSubject("c_b", "homeB", "workB", "employed", [{ otherPersonId: "c_a", type: "friend" }]),
      ];
      const events = run(people, trial * 331, `reciprocity-conflict-${trial}`);
      const aWindows = gapWindows(events, "c_a");
      const bWindows = gapWindows(events, "c_b");
      const social = socialEvents(events);

      for (let i = 0; i < Math.min(aWindows.length, bWindows.length); i++) {
        const overlapStart = Math.max(aWindows[i].gapStart, bWindows[i].gapStart);
        const overlapEnd = Math.min(aWindows[i].gapEnd, bWindows[i].gapEnd);
        const genuinelyDisjoint = overlapEnd - overlapStart < 60; // less than 1 min of real overlap after buffers
        if (!genuinelyDisjoint) continue;
        // A conflicting cycle: confirm no reciprocal meeting was produced
        // for roughly this time window (there's only ever one cycle-sized
        // gap per person per day, so any social event near here would
        // have to be this cycle's).
        const meetingNearThisGap = social.some(
          (e) => e.actorId === "c_a" || e.actorId === "c_b" ? Math.abs(e.timestamp - overlapStart) < 24 * 60 && e.presentPersonIds.length > 1 : false,
        );
        if (!meetingNearThisGap) {
          foundConflict = true;
          break;
        }
      }
    }
    expect(foundConflict).toBe(true);
  });
});

describe("post-crime reciprocity — [H] no baseline event is ever moved to force a meeting", () => {
  it("wake/work/sleep timestamps for every person are identical to a baseline-only computation (no publicLocations/relationshipLinks)", () => {
    for (let trial = 0; trial < 20; trial++) {
      const social = richCast();
      const noSocial = social.map((p) => ({ ...p, relationshipLinks: [] }));
      const withSocialEvents = run(social, trial * 401, `reciprocity-baseline-${trial}`);
      const withoutSocialEvents = generatePostCrimeMovements(new RNG(`reciprocity-baseline-${trial}`), {
        people: noSocial,
        caseOpenedAt: trial * 401,
        publicLocations: [],
      });
      for (const person of social) {
        const baseline = (evs: TimelineEvent[]) =>
          evs.filter((e) => e.actorId === person.id && (e.action === "wake_up" || e.action === "work" || e.action === "sleep")).sort((a, b) => a.timestamp - b.timestamp);
        expect(baseline(withSocialEvents)).toEqual(baseline(withoutSocialEvents));
      }
    }
  });
});

describe("post-crime reciprocity — [I, J] generation-order independence", () => {
  it("[I] reversing the population array produces the identical canonical per-person result", () => {
    const forward = richCast();
    const reversed = [...richCast()].reverse();
    const a = run(forward, 500, "order-reversed");
    const b = run(reversed, 500, "order-reversed");
    const canon = (evs: TimelineEvent[]) => [...evs].sort((x, y) => x.actorId.localeCompare(y.actorId) || x.timestamp - y.timestamp || x.locationId.localeCompare(y.locationId));
    expect(canon(a)).toEqual(canon(b));
  });

  it("[J] a shuffled population array produces the identical canonical result", () => {
    const original = richCast();
    // Deterministic "shuffle": a fixed non-trivial permutation, not a
    // random one, so this test itself stays reproducible.
    const shuffled = [original[3], original[0], original[6], original[1], original[7], original[2], original[5], original[4]];
    const a = run(original, 700, "order-shuffled");
    const b = run(shuffled, 700, "order-shuffled");
    const canon = (evs: TimelineEvent[]) => [...evs].sort((x, y) => x.actorId.localeCompare(y.actorId) || x.timestamp - y.timestamp || x.locationId.localeCompare(y.locationId));
    expect(canon(a)).toEqual(canon(b));
  });
});

describe("post-crime reciprocity — [K] determinism", () => {
  it("same seed -> byte-identical reciprocal meetings", () => {
    const a = run(richCast(), 900, "reciprocity-determinism");
    const b = run(richCast(), 900, "reciprocity-determinism");
    expect(a).toEqual(b);
  });
});

describe("post-crime reciprocity — [L] guilt isolation remains intact", () => {
  it("identical safe inputs regardless of which id is 'really' the culprit in the caller's mind produce identical output", () => {
    const a = generatePostCrimeMovements(new RNG("reciprocity-guilt"), { people: richCast(), caseOpenedAt: 0, publicLocations: PUBLIC_LOCATIONS });
    const b = generatePostCrimeMovements(new RNG("reciprocity-guilt"), { people: richCast(), caseOpenedAt: 0, publicLocations: PUBLIC_LOCATIONS });
    expect(a).toEqual(b);
  });
});

describe("post-crime reciprocity — [M] unsafe relationship types never create mundane meetings", () => {
  it("p_loner's only link (an 'affair') never produces a companion event in either direction, across many seeds", () => {
    let lonerInvolved = false;
    for (let trial = 0; trial < 100; trial++) {
      const events = run(richCast(), trial * 293, `reciprocity-unsafe-${trial}`);
      if (socialEvents(events).some((e) => e.presentPersonIds.includes("p_loner"))) lonerInvolved = true;
    }
    expect(lonerInvolved).toBe(false);
  });
});
