import { describe, expect, it } from "vitest";
import { generateBatch } from "../case-generator/generate-batch";
import type { Difficulty } from "../types/case";

/**
 * Large-scale statistical run across all four difficulties — the milestone
 * explicitly asks for 5,000-10,000 generated cases with validity, variety,
 * and difficulty-distribution tracking. Run on demand with:
 *   RUN_FULL_STATS=1 npx vitest run lib/game-engine/__tests__/case-variety-stats.test.ts
 * Skipped by default so the regular `npm test` suite stays fast — the
 * smaller `batch.test.ts` already exercises the same generator+validator
 * path on every run.
 */
const RUN_FULL = process.env.RUN_FULL_STATS === "1";
const PER_DIFFICULTY = 2000; // 4 difficulties * 2000 = 8000 total, within the 5k-10k target.

describe.skipIf(!RUN_FULL)("case variety statistics (5k-10k generation run)", () => {
  it("reports validity and structural-variety stats per difficulty", () => {
    const difficulties: Difficulty[] = ["recruit", "investigator", "inspector", "expert"];
    let grandTotal = 0;

    for (const difficulty of difficulties) {
      const summary = generateBatch(PER_DIFFICULTY, difficulty);
      grandTotal += summary.total;

      console.log(`\n=== ${difficulty.toUpperCase()} (${summary.total} cases) ===`);
      console.log("validity:", `${((summary.validCount / summary.total) * 100).toFixed(2)}%`, `(thrown: ${summary.thrownCount})`);
      console.log("averageSolvability:", summary.averageSolvability.toFixed(3));
      console.log("averageSuspects:", summary.averageSuspects.toFixed(2));
      console.log("averageEvidenceCount:", summary.averageEvidenceCount.toFixed(2));
      console.log("averageProofChannels:", summary.averageProofChannels.toFixed(2));
      console.log("accompliceFrequency:", summary.accompliceFrequency);
      console.log("stagingFrequency:", summary.stagingFrequency);
      console.log("falseConfessionFrequency:", `${(summary.falseConfessionFrequency * 100).toFixed(2)}%`);
      console.log("archetypeFrequency:", summary.archetypeFrequency);
      console.log("methodFrequency:", summary.methodFrequency);
      console.log("difficultyScoreBuckets:", summary.difficultyScoreBuckets);
      if (summary.commonErrors.length > 0) {
        console.log("topErrors:", summary.commonErrors.slice(0, 5));
      }

      expect(summary.validCount / summary.total).toBeGreaterThanOrEqual(0.95);
      expect(summary.averageSolvability).toBeGreaterThan(0.85);
    }

    console.log(`\nGRAND TOTAL GENERATED: ${grandTotal}`);
    expect(grandTotal).toBeGreaterThanOrEqual(5000);
  }, 300_000);
});
