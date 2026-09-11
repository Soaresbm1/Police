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
    let leakedBeforeStart = 0;
    let leakedAfterEnd = 0;
    let hiddenFieldLeaks = 0;
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
          for (const o of record.observations) {
            if (o.observedFrom < record.startedAt) leakedBeforeStart++;
            if (o.observedUntil > record.endedAt) leakedAfterEnd++;
            const keys = Object.keys(o).sort();
            if (keys.join(",") !== "locationId,observationType,observedFrom,observedUntil") hiddenFieldLeaks++;
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
      leakedBeforeStart,
      leakedAfterEnd,
      hiddenFieldLeaks,
      thrown,
    });

    expect(total).toBeGreaterThanOrEqual(500);
    expect(leakedBeforeStart).toBe(0);
    expect(leakedAfterEnd).toBe(0);
    expect(hiddenFieldLeaks).toBe(0);
    expect(thrown).toBe(0);
    // Both outcomes must actually occur across this sample — otherwise the
    // stress run isn't exercising the boundary/overlap logic at all.
    expect(valid).toBeGreaterThan(0);
    expect(rejected).toBeGreaterThan(0);
  }, 60_000);
});
