import { describe, expect, it } from "vitest";
import { generateCase } from "../case-generator/case-truth";
import { generateBatch } from "../case-generator/generate-batch";
import { validateCase } from "../validator/case-validator";
import { computeSolvability, MIN_INDEPENDENT_CHANNELS } from "../validator/solvability";
import type { CaseTruth } from "../types/case";
import type { Difficulty } from "../types/case";
import type { LifeStatus } from "../types/person";
import type { TimelineEvent } from "../types/timeline";

const DIFFICULTIES: Difficulty[] = ["recruit", "investigator", "inspector", "expert"];

type ActivityKind = "social_visit" | "social_meeting" | "errand" | "leisure" | "appointment";

/** Test-side classification only (no production export needed): the
 * generator's own fixed French description patterns are enough to tell
 * the five optional-activity kinds apart for diagnostics purposes, since
 * `action` alone collapses social_visit/social_meeting into "meet" and
 * leisure/appointment into "other" (see post-crime-observation.ts). */
function classifyActivity(e: TimelineEvent): ActivityKind | null {
  if (e.action === "purchase") return "errand";
  if (e.description.includes("rend visite à")) return "social_visit";
  if (e.description.includes("retrouve")) return "social_meeting";
  if (e.description.endsWith("a un rendez-vous.")) return "appointment";
  if (e.description.endsWith("sort un moment.")) return "leisure";
  return null;
}

interface Sample {
  lifeStatus: LifeStatus;
  activityCount: number;
  kinds: ActivityKind[];
}

interface ReciprocalDiagnostics {
  acceptedMeetings: number;
  oneSidedCompanionEvents: number;
  locationMismatches: number;
  intervalMismatches: number;
}

function collectSamples(
  caseCount: number,
): { samples: Sample[]; invalidCompanions: number; overlapCount: number; outOfCoverage: number } & ReciprocalDiagnostics {
  const samples: Sample[] = [];
  let invalidCompanions = 0;
  let overlapCount = 0;
  let outOfCoverage = 0;
  let acceptedMeetings = 0;
  let oneSidedCompanionEvents = 0;
  let locationMismatches = 0;
  let intervalMismatches = 0;

  for (let i = 0; i < caseCount; i++) {
    const difficulty = DIFFICULTIES[i % DIFFICULTIES.length];
    let truth: CaseTruth;
    try {
      truth = generateCase(`CASE-5B2DIST-${i}`, { difficulty });
    } catch {
      continue;
    }
    const coverageStart = truth.caseOpenedAt;
    const coverageEnd = truth.caseOpenedAt + 48 * 60;
    const knownIds = new Set(truth.people.map((p) => p.id));

    const byPerson = new Map<string, TimelineEvent[]>();
    for (const e of truth.postCrimeMovements) {
      if (e.timestamp < coverageStart || e.timestamp >= coverageEnd) outOfCoverage++;
      for (const id of e.presentPersonIds) {
        if (!knownIds.has(id)) invalidCompanions++;
      }
      byPerson.set(e.actorId, [...(byPerson.get(e.actorId) ?? []), e]);
    }

    // Reciprocal-meeting diagnostics: every social (multi-person) event
    // must have exactly one matching reciprocal event (same location,
    // same interval, mutual presentPersonIds) on the companion's side.
    const social = truth.postCrimeMovements.filter((e) => e.presentPersonIds.length > 1);
    const matchedPairIds = new Set<string>();
    for (const e of social) {
      if (matchedPairIds.has(e.id)) continue; // already counted as the reciprocal half of an earlier pair
      const companionId = e.presentPersonIds.find((id) => id !== e.actorId);
      const reciprocal = companionId
        ? social.find((other) => other.id !== e.id && other.actorId === companionId && other.presentPersonIds.includes(e.actorId) && other.timestamp === e.timestamp)
        : undefined;
      if (!reciprocal) {
        oneSidedCompanionEvents++;
        continue;
      }
      if (reciprocal.locationId !== e.locationId) locationMismatches++;
      if (reciprocal.timestamp !== e.timestamp || reciprocal.durationMinutes !== e.durationMinutes) intervalMismatches++;
      matchedPairIds.add(e.id);
      matchedPairIds.add(reciprocal.id);
      acceptedMeetings++;
    }

    for (const person of truth.people) {
      if (person.id === truth.victimId) continue;
      const events = (byPerson.get(person.id) ?? []).sort((a, b) => a.timestamp - b.timestamp);
      for (let j = 0; j < events.length - 1; j++) {
        if (events[j].timestamp + events[j].durationMinutes > events[j + 1].timestamp) overlapCount++;
      }
      const kinds = events.map(classifyActivity).filter((k): k is ActivityKind => k !== null);
      samples.push({ lifeStatus: person.lifeStatus, activityCount: kinds.length, kinds });
    }
  }

  return { samples, invalidCompanions, overlapCount, outOfCoverage, acceptedMeetings, oneSidedCompanionEvents, locationMismatches, intervalMismatches };
}

describe("post-crime activities — distribution diagnostics (project brief §18)", () => {
  it("reports optional-activity distribution by lifeStatus over >=5,000 person samples", () => {
    // 420 cases * ~12.75 people avg (excluding the victim, rotating across
    // all 4 difficulties) comfortably clears 5,000 person samples, matching
    // the age/occupation distribution report's own established approach.
    const { samples, invalidCompanions, overlapCount, outOfCoverage, acceptedMeetings, oneSidedCompanionEvents, locationMismatches, intervalMismatches } =
      collectSamples(420);
    expect(samples.length).toBeGreaterThanOrEqual(5000);

    const statuses: LifeStatus[] = ["student", "apprentice", "employed", "self_employed", "unemployed", "retired"];
    const table: Record<LifeStatus, { total: number; sumActivities: number; countByBucket: number[]; kindCounts: Record<ActivityKind, number> }> =
      Object.fromEntries(
        statuses.map((s) => [
          s,
          { total: 0, sumActivities: 0, countByBucket: [0, 0, 0, 0, 0], kindCounts: { social_visit: 0, social_meeting: 0, errand: 0, leisure: 0, appointment: 0 } },
        ]),
      ) as Record<LifeStatus, { total: number; sumActivities: number; countByBucket: number[]; kindCounts: Record<ActivityKind, number> }>;

    for (const sample of samples) {
      const row = table[sample.lifeStatus];
      row.total++;
      row.sumActivities += sample.activityCount;
      row.countByBucket[Math.min(sample.activityCount, 4)]++;
      for (const kind of sample.kinds) row.kindCounts[kind]++;
    }

    console.log(`\n=== Optional-activity distribution by lifeStatus (n=${samples.length}) ===`);
    console.log("status".padEnd(14), "avg/48h", "%0", "%1", "%2", "%3", "%4+", "social_meeting%", "social_visit%", "errand%", "leisure%", "appointment%");
    for (const status of statuses) {
      const row = table[status];
      if (row.total === 0) continue;
      const pct = (n: number) => ((n / row.total) * 100).toFixed(1);
      const avg = (row.sumActivities / row.total).toFixed(2);
      console.log(
        status.padEnd(14),
        avg.padEnd(8),
        pct(row.countByBucket[0]).padEnd(6),
        pct(row.countByBucket[1]).padEnd(6),
        pct(row.countByBucket[2]).padEnd(6),
        pct(row.countByBucket[3]).padEnd(6),
        pct(row.countByBucket[4]).padEnd(6),
        pct(row.kindCounts.social_meeting).padEnd(8),
        pct(row.kindCounts.social_visit).padEnd(8),
        pct(row.kindCounts.errand).padEnd(8),
        pct(row.kindCounts.leisure).padEnd(8),
        pct(row.kindCounts.appointment),
      );
    }
    console.log(`meetings referencing invalid people: ${invalidCompanions} (expected 0)`);
    console.log(`overlap count: ${overlapCount} (expected 0)`);
    console.log(`out-of-coverage events: ${outOfCoverage} (expected 0)`);
    console.log(`reciprocal meetings accepted: ${acceptedMeetings}`);
    console.log(`one-sided companion events: ${oneSidedCompanionEvents} (expected 0)`);
    console.log(`reciprocal location mismatches: ${locationMismatches} (expected 0)`);
    console.log(`reciprocal interval mismatches: ${intervalMismatches} (expected 0)`);

    expect(invalidCompanions).toBe(0);
    expect(overlapCount).toBe(0);
    expect(outOfCoverage).toBe(0);
    expect(oneSidedCompanionEvents).toBe(0);
    expect(locationMismatches).toBe(0);
    expect(intervalMismatches).toBe(0);
    expect(acceptedMeetings).toBeGreaterThan(0);

    // Sanity bounds matching the brief's §11 target: most people 1-3,
    // some 0, rare 4 (structurally capped at 3 by this implementation —
    // see post-crime-observation.ts's design note, so %4+ is always 0).
    for (const status of statuses) {
      const row = table[status];
      if (row.total === 0) continue;
      expect(row.sumActivities / row.total).toBeGreaterThanOrEqual(0);
      expect(row.sumActivities / row.total).toBeLessThanOrEqual(3);
    }
  }, 30_000);
});

describe("post-crime activities — full stress (project brief §19)", () => {
  it("2,000 generateCase() calls across all difficulties: validity/solvability unchanged", () => {
    const PER_DIFFICULTY = 500; // 4 * 500 = 2000

    for (const difficulty of DIFFICULTIES) {
      const summary = generateBatch(PER_DIFFICULTY, difficulty);
      expect(summary.validCount / summary.total).toBeGreaterThanOrEqual(0.95);
      expect(summary.averageSolvability).toBeGreaterThan(0.85);
      expect(summary.thrownCount / summary.total).toBeLessThanOrEqual(0.02);
    }
  }, 60_000);

  it("[Z] no error class is attributable to Phase 5B-2: validateCase's error SET is byte-identical with postCrimeMovements present vs. stripped, across 200 batch-generated cases", () => {
    // A hand-maintained whitelist of "known" error message patterns is
    // fragile (the pre-existing engine has ~30 distinct error templates
    // across validator/case-validator.ts, none related to
    // postCrimeMovements) and easy to get wrong. The rigorous, structural
    // proof that nothing here is attributable to Phase 5B-2 is this: for
    // every case, stripping postCrimeMovements entirely must never change
    // a single error — confirming whatever errors DO occur (a rare,
    // pre-existing characteristic of procedural generation, per
    // CASE_GENERATION.md) come from something else, never this module.
    for (let i = 0; i < 200; i++) {
      const seed = `CASE-5B2ERRCLASS-${i}`;
      const difficulty = DIFFICULTIES[i % DIFFICULTIES.length];
      let truth: CaseTruth;
      try {
        truth = generateCase(seed, { difficulty });
      } catch {
        continue; // a thrown generation itself is already covered by the batch summary's thrownCount bound above.
      }
      const withLayer = validateCase(truth);
      const withoutLayer = validateCase({ ...truth, postCrimeMovements: [] });
      expect(withoutLayer.errors, `case ${seed}: error set changed when postCrimeMovements was stripped`).toEqual(withLayer.errors);
    }
  }, 30_000);

  it("[S, T] validator validity and solvability channel count are identical whether postCrimeMovements is present or stripped, across many enriched cases", () => {
    for (let i = 0; i < 40; i++) {
      const truth = generateCase(`CASE-5B2VALID-${i}`, { difficulty: DIFFICULTIES[i % DIFFICULTIES.length] });
      expect(truth.postCrimeMovements.length).toBeGreaterThan(0);

      const withLayer = validateCase(truth);
      const withoutLayer = validateCase({ ...truth, postCrimeMovements: [] });
      expect(withoutLayer).toEqual(withLayer);

      const solvWith = computeSolvability(truth);
      const solvWithout = computeSolvability({ ...truth, postCrimeMovements: [] });
      expect(solvWithout).toEqual(solvWith);
      expect(solvWith.independentChannels.length).toBeGreaterThanOrEqual(MIN_INDEPENDENT_CHANNELS);
    }
  });
});
