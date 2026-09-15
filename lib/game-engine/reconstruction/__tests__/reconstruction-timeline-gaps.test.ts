import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateCase } from "../../case-generator/case-truth";
import type { Difficulty } from "../../types/case";
import { buildPresentationTimeline, computeTimelineSegments, GAP_THRESHOLD_SECONDS } from "../reconstruction-presentation";
import { projectReconstruction } from "../reconstruction-projector";

const DIFFICULTIES: Difficulty[] = ["recruit", "investigator", "inspector", "expert"];
const PER_DIFFICULTY = 500;

function seedFor(i: number): string {
  return `CASE-${(i + 90000).toString(36).toUpperCase().padStart(6, "0").slice(-6)}`;
}

describe("long-gap compression (1800 s) across 2,000 generated scenarios", () => {
  it(
    "compresses only the dead period before discovery, after all movement, with the body still present",
    () => {
      let projected = 0;
      let noCompression = 0;
      let multipleCompressions = 0;
      let compressionsNotEndingAtDiscovery = 0;
      let compressionsWithoutDiscovery = 0;
      let holdsNotOnePerScenario = 0;
      let movementDuringSkip = 0;
      let bodyAbsentAcrossSkip = 0;
      let eventTimesRewritten = 0;
      const compressedGapHours: number[] = [];
      const holdDelaySeconds: number[] = [];
      let largestUncompressedGapSeconds = 0;
      let smallestCompressedGapSeconds = Infinity;

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
          const segments = computeTimelineSegments(scenario);
          const timeline = buildPresentationTimeline(scenario);
          if (JSON.stringify(scenario.events) !== before) eventTimesRewritten++;

          const compressed = segments.filter((s) => s.compressible);
          const discover = scenario.events.find((e) => e.type === "discover");
          const attack = scenario.events.find((e) => e.type === "attack");

          if (compressed.length === 0) noCompression++;
          if (compressed.length > 1) multipleCompressions++;
          if (timeline.holdPoints.length !== 1) holdsNotOnePerScenario++;

          for (const s of compressed) {
            compressedGapHours.push((s.end - s.start) / 3600);
            smallestCompressedGapSeconds = Math.min(smallestCompressedGapSeconds, s.end - s.start);
            if (!discover) compressionsWithoutDiscovery++;
            else if (s.end !== discover.time) compressionsNotEndingAtDiscovery++;
          }
          for (const s of segments.filter((x) => !x.compressible)) {
            largestUncompressedGapSeconds = Math.max(largestUncompressedGapSeconds, s.end - s.start);
          }

          for (const gap of timeline.segments.filter((s) => s.kind === "gap")) {
            holdDelaySeconds.push(gap.truthStart - (compressed[0]?.start ?? gap.truthStart));
            for (const actor of scenario.actors) {
              const isBody = attack?.counterpartyVisualId === actor.visualId && gap.truthStart >= attack.time;
              if (isBody) {
                if (actor.despawnTime < gap.truthEnd) bodyAbsentAcrossSkip++;
              } else if (actor.spawnTime < gap.truthEnd && actor.despawnTime > gap.truthStart) {
                movementDuringSkip++;
              }
            }
          }
        }
      }

      compressedGapHours.sort((a, b) => a - b);
      holdDelaySeconds.sort((a, b) => a - b);
      const report = {
        projected,
        noCompression,
        multipleCompressions,
        compressedGaps: compressedGapHours.length,
        medianCompressedGapHours: compressedGapHours[Math.floor(compressedGapHours.length / 2)],
        minCompressedGapHours: compressedGapHours[0],
        maxCompressedGapHours: compressedGapHours[compressedGapHours.length - 1],
        smallestCompressedGapSeconds,
        largestUncompressedGapSeconds,
        compressionsNotEndingAtDiscovery,
        compressionsWithoutDiscovery,
        holdsNotOnePerScenario,
        medianHoldDelayAfterGapStartSeconds: holdDelaySeconds[Math.floor(holdDelaySeconds.length / 2)],
        movementDuringSkip,
        bodyAbsentAcrossSkip,
        eventTimesRewritten,
      };
      writeFileSync(join(tmpdir(), "u53_timeline_gaps.json"), JSON.stringify(report, null, 2));

      expect(projected).toBeGreaterThan(1900);
      expect(compressionsNotEndingAtDiscovery).toBe(0);
      expect(compressionsWithoutDiscovery).toBe(0);
      expect(multipleCompressions).toBe(0);
      expect(largestUncompressedGapSeconds).toBeLessThan(GAP_THRESHOLD_SECONDS);
      expect(holdsNotOnePerScenario).toBe(0);
      expect(movementDuringSkip).toBe(0);
      expect(bodyAbsentAcrossSkip).toBe(0);
      expect(eventTimesRewritten).toBe(0);
    },
    10 * 60 * 1000,
  );
});
