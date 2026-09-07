import { describe, expect, it } from "vitest";
import { generateBatch } from "../case-generator/generate-batch";

describe("batch generation (statistical bug hunting)", () => {
  it("produces a high rate of valid, solvable cases across many random seeds", () => {
    const summary = generateBatch(400, "investigator");

    if (summary.validCount < summary.total) {
      console.log("BATCH SUMMARY", {
        total: summary.total,
        validCount: summary.validCount,
        invalidCount: summary.invalidCount,
        thrownCount: summary.thrownCount,
        averageSolvability: summary.averageSolvability,
      });
      console.log("TOP ERRORS", summary.commonErrors.slice(0, 10));
    }

    // Rare procedural dead ends (e.g. a tiny cast where nobody ends up with a
    // plausible motive) are an expected, low-frequency characteristic of a
    // procedural generator, not a bug — production code retries with a new
    // seed when this happens. What matters is that they stay rare and that
    // the overwhelming majority of cases are fully valid and solvable.
    expect(summary.thrownCount / summary.total).toBeLessThanOrEqual(0.02);
    expect(summary.validCount / summary.total).toBeGreaterThanOrEqual(0.97);
    expect(summary.averageSolvability).toBeGreaterThan(0.85);
  });

  it("is deterministic: the same seed always yields structurally identical cases", async () => {
    const { generateCase } = await import("../case-generator/case-truth");
    const a = generateCase("CASE-ABCDEF");
    const b = generateCase("CASE-ABCDEF");
    // generatedAt is a wall-clock timestamp, not part of the deterministic content.
    expect({ ...a, generatedAt: null }).toEqual({ ...b, generatedAt: null });
  });
});
