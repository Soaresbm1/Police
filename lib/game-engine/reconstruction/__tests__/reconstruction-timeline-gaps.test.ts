import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateCase } from "../../case-generator/case-truth";
import type { Difficulty } from "../../types/case";
import {
  buildPresentationTimeline,
  IDLE_SKIP_THRESHOLD_SECONDS,
  mergedActivitySpans,
  POST_ACTIVITY_DWELL_SECONDS,
} from "../reconstruction-presentation";
import { projectReconstruction } from "../reconstruction-projector";

const DIFFICULTIES: Difficulty[] = ["recruit", "investigator", "inspector", "expert"];
const PER_DIFFICULTY = 500;

function seedFor(i: number): string {
  return `CASE-${(i + 90000).toString(36).toUpperCase().padStart(6, "0").slice(-6)}`;
}

/**
 * Phase U5.4 — the compression contract across 2,000 generated scenarios: a skip only ever covers truth in which
 * nothing is shown moving, it always starts after the dwell that follows the last thing that did move, and it
 * never changes, hides or reorders a semantic event. Replaces U5.3's event-gap version of the same guarantee,
 * which could only ever skip the one long gap before the discovery.
 */
describe("presentation pacing across 2,000 generated scenarios", () => {
  it(
    "skips only idle truth, never an event, never movement, never the body",
    () => {
      let projected = 0;
      let scenariosWithoutSkip = 0;
      let eventInsideSkip = 0;
      let activityInsideSkip = 0;
      let skipShorterThanThreshold = 0;
      let skipNotAfterDwell = 0;
      let bodyAbsentAcrossSkip = 0;
      let eventTimesRewritten = 0;
      let markersOutOfOrder = 0;
      const skipsPerScenario: number[] = [];
      const watchedSeconds: number[] = [];
      const truthSeconds: number[] = [];

      for (const difficulty of DIFFICULTIES) {
        for (let i = 0; i < PER_DIFFICULTY; i++) {
          let result;
          try {
            result = projectReconstruction(generateCase(seedFor(i), { difficulty }), `gaps-${difficulty}-${i}`);
          } catch {
            continue;
          }
          if (!result.ok) continue;
          projected++;

          const scenario = result.scenario;
          const before = JSON.stringify(scenario.events);
          const timeline = buildPresentationTimeline(scenario);
          if (JSON.stringify(scenario.events) !== before) eventTimesRewritten++;

          const activity = mergedActivitySpans(scenario);
          const gaps = timeline.segments.filter((s) => s.kind === "gap");
          const plays = timeline.segments.filter((s) => s.kind === "play");
          const attack = scenario.events.find((e) => e.type === "attack");

          skipsPerScenario.push(gaps.length);
          if (gaps.length === 0) scenariosWithoutSkip++;
          watchedSeconds.push(plays.reduce((sum, p) => sum + (p.truthEnd - p.truthStart), 0));
          truthSeconds.push(scenario.durationSeconds);

          const positions = timeline.markers.map((m) => m.barPosition);
          if ([...positions].sort((a, b) => a - b).join() !== positions.join()) markersOutOfOrder++;

          for (const gap of gaps) {
            if (gap.truthEnd - gap.truthStart < IDLE_SKIP_THRESHOLD_SECONDS) skipShorterThanThreshold++;
            if (scenario.events.some((e) => e.time > gap.truthStart && e.time < gap.truthEnd)) eventInsideSkip++;
            if (activity.some((s) => s.start < gap.truthEnd && s.end > gap.truthStart)) activityInsideSkip++;

            const lastActivityEnd = activity.filter((s) => s.end <= gap.truthStart).reduce((latest, s) => Math.max(latest, s.end), 0);
            if (Math.abs(gap.truthStart - Math.min(lastActivityEnd + POST_ACTIVITY_DWELL_SECONDS, scenario.durationSeconds)) > 1e-6) skipNotAfterDwell++;

            for (const actor of scenario.actors) {
              const isBody = attack?.counterpartyVisualId === actor.visualId && gap.truthStart >= attack.time;
              if (isBody && actor.despawnTime < gap.truthEnd) bodyAbsentAcrossSkip++;
            }
          }
        }
      }

      const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
      const report = {
        projected,
        scenariosWithoutSkip,
        medianSkipsPerScenario: median(skipsPerScenario),
        maxSkipsPerScenario: Math.max(...skipsPerScenario),
        medianWatchedSeconds: Math.round(median(watchedSeconds)),
        maxWatchedSeconds: Math.round(Math.max(...watchedSeconds)),
        medianTruthSeconds: Math.round(median(truthSeconds)),
        eventInsideSkip,
        activityInsideSkip,
        skipShorterThanThreshold,
        skipNotAfterDwell,
        bodyAbsentAcrossSkip,
        eventTimesRewritten,
        markersOutOfOrder,
      };
      writeFileSync(join(tmpdir(), "u54_pacing_gaps.json"), JSON.stringify(report, null, 2));

      expect(projected).toBeGreaterThan(1900);
      expect(eventInsideSkip).toBe(0);
      expect(activityInsideSkip).toBe(0);
      expect(skipShorterThanThreshold).toBe(0);
      expect(skipNotAfterDwell).toBe(0);
      expect(bodyAbsentAcrossSkip).toBe(0);
      expect(eventTimesRewritten).toBe(0);
      expect(markersOutOfOrder).toBe(0);
      // A player should watch a reconstruction, not sit through the case's real duration.
      expect(median(watchedSeconds)).toBeLessThan(120);
    },
    10 * 60 * 1000,
  );
});
