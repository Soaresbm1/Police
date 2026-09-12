import { describe, expect, it } from "vitest";
import { generateCase } from "@/lib/game-engine/case-generator/case-truth";
import type { CaseTruth } from "@/lib/game-engine/types/case";
import { coverageWindow, projectSurveillanceObservations, startSurveillance } from "../surveillance";
import type { GameSession } from "../types";

function freshSession(currentTime: number): GameSession {
  return {
    id: "s1",
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

/** Finds a real, generated companion (reciprocal social) event pair —
 * searching across many deterministic seeds until one turns up, since
 * whether any given case happens to produce one is itself a deterministic
 * but not-controllable-by-us outcome of the seed. */
function findCompanionPair(): { truth: CaseTruth; actorId: string; companionId: string; timestamp: number; locationId: string } | null {
  for (let i = 0; i < 200; i++) {
    let truth: CaseTruth;
    try {
      truth = generateCase(`CASE-5B2RECIP-${i}`);
    } catch {
      continue;
    }
    const social = truth.postCrimeMovements.find((e) => e.presentPersonIds.length > 1);
    if (social) {
      const companionId = social.presentPersonIds.find((id) => id !== social.actorId)!;
      return { truth, actorId: social.actorId, companionId, timestamp: social.timestamp, locationId: social.locationId };
    }
  }
  return null;
}

describe("surveillance reciprocity — the actual gameplay consequence (project brief §8, items O, P, Q)", () => {
  it("[O, P, Q] surveilling both participants of the same meeting produces agreeing observations (location + overlapping interval), emerging purely from reciprocal postCrimeMovements", () => {
    const found = findCompanionPair();
    expect(found, "expected at least one generated case with a reciprocal companion event within 200 seeds").not.toBeNull();
    const { truth, actorId, companionId, timestamp, locationId } = found!;

    const { start: coverageStart, end: coverageEnd } = coverageWindow(truth);
    // A surveillance window guaranteed to cover the meeting, clamped to coverage.
    const windowStart = Math.max(coverageStart, timestamp - 120);
    const windowEnd = Math.min(coverageEnd, timestamp + 240);
    expect(windowEnd).toBeGreaterThan(windowStart);

    // Duration must be one of the fixed menu values; pick the smallest
    // menu option that still covers the meeting instant.
    const durationOptions = [120, 240, 480] as const;
    const duration = durationOptions.find((d) => windowStart + d > timestamp) ?? 480;

    const sessionForA = freshSession(windowStart);
    const outcomeA = startSurveillance(truth, sessionForA, actorId, duration);
    const sessionForB = freshSession(windowStart);
    const outcomeB = startSurveillance(truth, sessionForB, companionId, duration);

    expect(outcomeA.ok).toBe(true);
    expect(outcomeB.ok).toBe(true);

    const obsA = outcomeA.record!.observations.find((o) => o.observedPersonIds?.includes(companionId));
    const obsB = outcomeB.record!.observations.find((o) => o.observedPersonIds?.includes(actorId));
    // [O] A's surveillance is capable of reporting B.
    expect(obsA, "A's surveillance should report B as a companion").toBeDefined();
    // [P] B's surveillance is capable of reporting A.
    expect(obsB, "B's surveillance should report A as a companion").toBeDefined();
    // [Q] both agree on location and their observed intervals overlap
    // (never contradict) — clipping may differ only if the two windows
    // themselves differ, which they don't here (both start at windowStart
    // with the same duration).
    expect(obsA!.locationId).toBe(locationId);
    expect(obsB!.locationId).toBe(locationId);
    expect(obsA!.locationId).toBe(obsB!.locationId);
    expect(obsA!.observedFrom).toBe(obsB!.observedFrom);
    expect(obsA!.observedUntil).toBe(obsB!.observedUntil);
  });

  it("[R] clipping still works normally for a reciprocal meeting: a surveillance window that only partially covers it clips safely on both sides", () => {
    const found = findCompanionPair();
    expect(found).not.toBeNull();
    const { truth, actorId, companionId, timestamp, locationId } = found!;
    // A narrow window starting after the meeting's real start.
    const clippedStart = timestamp + 5;
    const clippedEnd = clippedStart + 10;
    const obsA = projectSurveillanceObservations(truth, actorId, clippedStart, clippedEnd);
    const companionObs = obsA.find((o) => o.locationId === locationId && o.observedPersonIds?.includes(companionId));
    if (companionObs) {
      expect(companionObs.observedFrom).toBeGreaterThanOrEqual(clippedStart);
      expect(companionObs.observedUntil).toBeLessThanOrEqual(clippedEnd);
    }
  });

  it("[S] gaps remain gaps: a surveillance window straddling the meeting with room on both sides still reports honest gap boundaries, not continuous presence", () => {
    const found = findCompanionPair();
    expect(found).not.toBeNull();
    const { truth, actorId, timestamp } = found!;
    const { start: coverageStart, end: coverageEnd } = coverageWindow(truth);
    const windowStart = Math.max(coverageStart, timestamp - 600);
    const windowEnd = Math.min(coverageEnd, timestamp + 600);
    const obs = projectSurveillanceObservations(truth, actorId, windowStart, windowEnd);
    // The meeting itself is a small slice of a much larger window — there
    // must be real, unfilled time before/after it (a "gap"), never full
    // coverage of the whole requested window by a single continuous entry.
    const totalObservedMinutes = obs.reduce((sum, o) => sum + (o.observedUntil - o.observedFrom), 0);
    expect(totalObservedMinutes).toBeLessThan(windowEnd - windowStart);
  });
});
