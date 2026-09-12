import { describe, expect, it } from "vitest";
import { generateCase } from "@/lib/game-engine/case-generator/case-truth";
import { generateCaseSeed } from "@/lib/game-engine/random/rng";
import type { Difficulty } from "@/lib/game-engine/types/case";
import { coverageWindow, startSurveillance, SURVEILLANCE_DURATIONS_MINUTES } from "../surveillance";
import type { GameSession } from "../types";

function freshSession(currentTime: number): GameSession {
  return {
    id: "stress",
    seed: "n/a",
    difficulty: "investigator",
    createdAt: Date.now(),
    currentTime,
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
  };
}

const DIFFICULTIES: Difficulty[] = ["recruit", "investigator", "inspector", "expert"];

/**
 * Project brief §20: at least 500 deterministic surveillance requests
 * across generated cases, multiple durations, multiple persons, and
 * boundary cases near coverage end — asserting zero leaks and zero thrown
 * errors, not just a high validity rate (unlike the engine's own
 * generateBatch, a rejected surveillance request is an entirely expected,
 * correct outcome here, not a defect to minimize).
 */
describe("surveillance — stress/validation (project brief §20)", () => {
  it("500+ deterministic surveillance requests: zero leaks, zero thrown errors", () => {
    let total = 0;
    let rejected = 0;
    let valid = 0;
    let observationCount = 0;
    let companionObservationCount = 0;
    let leakedBeforeStart = 0;
    let leakedAfterEnd = 0;
    let hiddenFieldLeaks = 0;
    let invalidCompanionIds = 0;
    let thrown = 0;

    const REQUESTS_PER_CASE = 5;
    const CASE_COUNT = 110; // 110 * 5 = 550 requests, over the 500 target.

    for (let i = 0; i < CASE_COUNT; i++) {
      const seed = generateCaseSeed();
      const difficulty = DIFFICULTIES[i % DIFFICULTIES.length];
      let truth;
      try {
        truth = generateCase(seed, { difficulty });
      } catch {
        continue; // rare procedural dead end at the engine level — unrelated to surveillance, skip like generateBatch does.
      }
      const { start: coverageStart, end: coverageEnd } = coverageWindow(truth);
      const candidates = truth.people.filter((p) => p.id !== truth.victimId);
      if (candidates.length === 0) continue;

      for (let j = 0; j < REQUESTS_PER_CASE; j++) {
        total++;
        const person = candidates[j % candidates.length];
        const duration = SURVEILLANCE_DURATIONS_MINUTES[j % SURVEILLANCE_DURATIONS_MINUTES.length];

        // Deterministic spread of start times, including boundary cases
        // deliberately placed right up against (and just past) the
        // coverage window's end.
        const offsetFraction = (j * 137 + i * 977) % 100; // 0-99, deterministic
        const start = coverageStart + Math.floor(((coverageEnd - coverageStart - duration) * offsetFraction) / 100);
        const nearBoundary = j === REQUESTS_PER_CASE - 1;
        const startedAt = nearBoundary ? coverageEnd - duration + (i % 3) * 30 : start; // sometimes intentionally just past the boundary

        const session = freshSession(startedAt);
        try {
          const result = startSurveillance(truth, session, person.id, duration);
          if (!result.ok) {
            rejected++;
            continue;
          }
          valid++;
          const record = result.record!;
          observationCount += record.observations.length;
          const knownPersonIds = new Set(truth.people.map((p) => p.id));
          for (const o of record.observations) {
            if (o.observedFrom < record.startedAt) leakedBeforeStart++;
            if (o.observedUntil > record.endedAt) leakedAfterEnd++;
            const keys = Object.keys(o).sort();
            const safeKeys = o.observedPersonIds
              ? "locationId,observationType,observedFrom,observedPersonIds,observedUntil"
              : "locationId,observationType,observedFrom,observedUntil";
            if (keys.join(",") !== safeKeys) hiddenFieldLeaks++;
            if (o.observedPersonIds) {
              companionObservationCount++;
              for (const id of o.observedPersonIds) {
                if (id === person.id || !knownPersonIds.has(id)) invalidCompanionIds++;
              }
            }
          }
        } catch {
          thrown++;
        }
      }
    }

    console.log("SURVEILLANCE STRESS SUMMARY", {
      total,
      valid,
      rejected,
      observationCount,
      companionObservationCount,
      leakedBeforeStart,
      leakedAfterEnd,
      hiddenFieldLeaks,
      invalidCompanionIds,
      thrown,
    });

    expect(total).toBeGreaterThanOrEqual(500);
    expect(leakedBeforeStart).toBe(0);
    expect(leakedAfterEnd).toBe(0);
    expect(hiddenFieldLeaks).toBe(0);
    expect(invalidCompanionIds).toBe(0);
    expect(thrown).toBe(0);
    // Both outcomes must actually occur across this sample — otherwise the
    // stress run isn't exercising the boundary/overlap logic at all.
    expect(valid).toBeGreaterThan(0);
    expect(rejected).toBeGreaterThan(0);
  }, 60_000);

  /**
   * Project brief §12: "explicit paired-surveillance stress for reciprocal
   * meetings" — searches generated cases for real companion (reciprocal)
   * events, then runs an independent surveillance request for BOTH
   * participants over a window covering the meeting, and checks their
   * observations agree.
   */
  it("paired surveillance over reciprocal meetings: both sides agree, zero mismatches, across many found meetings", () => {
    let casesScanned = 0;
    let meetingsFound = 0;
    let pairsChecked = 0;
    let reciprocalMismatches = 0;
    let thrown = 0;

    for (let i = 0; i < 400 && meetingsFound < 60; i++) {
      casesScanned++;
      let truth;
      try {
        truth = generateCase(`CASE-5B2PAIRED-${i}`, { difficulty: DIFFICULTIES[i % DIFFICULTIES.length] });
      } catch {
        continue;
      }
      const social = truth.postCrimeMovements.filter((e) => e.presentPersonIds.length > 1);
      if (social.length === 0) continue;

      const { start: coverageStart, end: coverageEnd } = coverageWindow(truth);
      for (const e of social) {
        const companionId = e.presentPersonIds.find((id) => id !== e.actorId);
        if (!companionId) continue;
        meetingsFound++;

        const windowStart = Math.max(coverageStart, e.timestamp - 30);
        const duration = SURVEILLANCE_DURATIONS_MINUTES.find((d) => windowStart + d > e.timestamp && windowStart + d <= coverageEnd);
        if (!duration) continue; // no fixed-menu duration fits without exceeding coverage — skip, not a failure

        try {
          pairsChecked++;
          const sessionA = freshSession(windowStart);
          const outcomeA = startSurveillance(truth, sessionA, e.actorId, duration);
          const sessionB = freshSession(windowStart);
          const outcomeB = startSurveillance(truth, sessionB, companionId, duration);
          if (!outcomeA.ok || !outcomeB.ok) continue; // eligibility/overlap rejection unrelated to reciprocity itself

          const obsA = outcomeA.record!.observations.find((o) => o.locationId === e.locationId && o.observedPersonIds?.includes(companionId));
          const obsB = outcomeB.record!.observations.find((o) => o.locationId === e.locationId && o.observedPersonIds?.includes(e.actorId));
          if (!obsA || !obsB || obsA.locationId !== obsB.locationId || obsA.observedFrom !== obsB.observedFrom || obsA.observedUntil !== obsB.observedUntil) {
            reciprocalMismatches++;
          }
        } catch {
          thrown++;
        }
      }
    }

    console.log("PAIRED SURVEILLANCE RECIPROCITY STRESS", { casesScanned, meetingsFound, pairsChecked, reciprocalMismatches, thrown });

    expect(meetingsFound).toBeGreaterThan(0);
    expect(pairsChecked).toBeGreaterThan(0);
    expect(reciprocalMismatches).toBe(0);
    expect(thrown).toBe(0);
  }, 60_000);
});
