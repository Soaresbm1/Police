import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateCase } from "../../case-generator/case-truth";
import type { Difficulty } from "../../types/case";
import { projectReconstruction } from "../reconstruction-projector";
import type { ReconstructionScenario } from "../reconstruction-types";

// Mirrors Unity's ReconstructionTimelineSegmenter.ComputeSegments; keep the two in sync.
const GAP_THRESHOLD_SECONDS = 1800;

interface Segment {
  start: number;
  end: number;
  compressible: boolean;
}

function computeSegments(scenario: ReconstructionScenario): Segment[] {
  const times = [...new Set(scenario.events.map((e) => e.time))].sort((a, b) => a - b);
  const segments: Segment[] = [];
  let cursor = 0;
  for (const t of times) {
    if (t > cursor) segments.push({ start: cursor, end: t, compressible: t - cursor >= GAP_THRESHOLD_SECONDS });
    cursor = t;
  }
  if (times.length > 0 && scenario.durationSeconds > cursor) {
    segments.push({ start: cursor, end: scenario.durationSeconds, compressible: scenario.durationSeconds - cursor >= GAP_THRESHOLD_SECONDS });
  }
  return segments;
}

const DIFFICULTIES: Difficulty[] = ["recruit", "investigator", "inspector", "expert"];
const PER_DIFFICULTY = 500;

function seedFor(i: number): string {
  return `CASE-${(i + 90000).toString(36).toUpperCase().padStart(6, "0").slice(-6)}`;
}

describe("long-gap compression threshold (1800 s) across 2,000 generated scenarios", () => {
  it(
    "compresses only the dead period before discovery, never an in-scene interval",
    () => {
      let projected = 0;
      let noCompression = 0;
      let multipleCompressions = 0;
      let compressionsNotEndingAtDiscovery = 0;
      let compressionsWithoutDiscovery = 0;
      const compressedGapHours: number[] = [];
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
          const segments = computeSegments(scenario);
          const compressed = segments.filter((s) => s.compressible);
          const discover = scenario.events.find((e) => e.type === "discover");

          if (compressed.length === 0) noCompression++;
          if (compressed.length > 1) multipleCompressions++;
          for (const s of compressed) {
            compressedGapHours.push((s.end - s.start) / 3600);
            smallestCompressedGapSeconds = Math.min(smallestCompressedGapSeconds, s.end - s.start);
            if (!discover) compressionsWithoutDiscovery++;
            else if (s.end !== discover.time) compressionsNotEndingAtDiscovery++;
          }
          for (const s of segments.filter((x) => !x.compressible)) {
            largestUncompressedGapSeconds = Math.max(largestUncompressedGapSeconds, s.end - s.start);
          }
        }
      }

      compressedGapHours.sort((a, b) => a - b);
      const median = compressedGapHours[Math.floor(compressedGapHours.length / 2)];
      const report = {
        projected,
        noCompression,
        multipleCompressions,
        compressedGaps: compressedGapHours.length,
        medianCompressedGapHours: median,
        minCompressedGapHours: compressedGapHours[0],
        maxCompressedGapHours: compressedGapHours[compressedGapHours.length - 1],
        smallestCompressedGapSeconds,
        largestUncompressedGapSeconds,
        compressionsNotEndingAtDiscovery,
        compressionsWithoutDiscovery,
      };
      writeFileSync(join(tmpdir(), "u5222_timeline_gaps.json"), JSON.stringify(report, null, 2));

      expect(projected).toBeGreaterThan(1900);
      expect(compressionsNotEndingAtDiscovery).toBe(0);
      expect(compressionsWithoutDiscovery).toBe(0);
      expect(multipleCompressions).toBe(0);
      expect(largestUncompressedGapSeconds).toBeLessThan(GAP_THRESHOLD_SECONDS);
    },
    10 * 60 * 1000,
  );
});
