import type { Difficulty } from "../types/case";
import { generateCaseSeed } from "../random/rng";
import { generateCase } from "./case-truth";
import { validateCase, type ValidationResult } from "../validator/case-validator";
import { computeSolvability } from "../validator/solvability";

export interface BatchCaseResult {
  seed: string;
  validation: ValidationResult | null;
  thrown: string | null;
}

export interface BatchSummary {
  total: number;
  validCount: number;
  invalidCount: number;
  thrownCount: number;
  averageSolvability: number;
  commonErrors: { message: string; count: number }[];
  results: BatchCaseResult[];
  /** Variety statistics — the whole point of this milestone: two generated
   * cases should differ structurally, not just cosmetically. */
  averageSuspects: number;
  averageEvidenceCount: number;
  averageProofChannels: number;
  accompliceFrequency: { none: number; one: number; two: number };
  stagingFrequency: Record<string, number>;
  falseConfessionFrequency: number;
  archetypeFrequency: Record<string, number>;
  methodFrequency: Record<string, number>;
  difficultyScoreBuckets: { low: number; medium: number; high: number };
}

function bump(record: Record<string, number>, key: string) {
  record[key] = (record[key] ?? 0) + 1;
}

/** Generates `count` fresh cases and validates each, for statistically
 * hunting down rare generator bugs and tracking case-variety metrics. Dev/
 * test tool only — never called from production gameplay code. Each
 * CaseTruth is discarded immediately after its stats are extracted so this
 * stays memory-safe even at 10,000+ cases. */
export function generateBatch(count: number, difficulty?: Difficulty): BatchSummary {
  const results: BatchCaseResult[] = [];

  let suspectsSum = 0;
  let evidenceSum = 0;
  let proofChannelsSum = 0;
  const accompliceFrequency = { none: 0, one: 0, two: 0 };
  const stagingFrequency: Record<string, number> = {};
  let falseConfessionCount = 0;
  const archetypeFrequency: Record<string, number> = {};
  const methodFrequency: Record<string, number> = {};
  const difficultyScoreBuckets = { low: 0, medium: 0, high: 0 };

  for (let i = 0; i < count; i++) {
    const seed = generateCaseSeed();
    try {
      const truth = generateCase(seed, { difficulty });
      const validation = validateCase(truth);
      results.push({ seed, validation, thrown: null });

      suspectsSum += truth.suspectIds.length;
      evidenceSum += truth.evidence.length;
      proofChannelsSum += computeSolvability(truth).independentChannels.length;

      const accCount = truth.accomplices.length;
      if (accCount === 0) accompliceFrequency.none++;
      else if (accCount === 1) accompliceFrequency.one++;
      else accompliceFrequency.two++;

      bump(stagingFrequency, truth.staging.type);
      if (truth.falseConfession) falseConfessionCount++;
      bump(archetypeFrequency, truth.archetype);
      bump(methodFrequency, truth.methodType);

      if (validation.difficultyScore < 0.33) difficultyScoreBuckets.low++;
      else if (validation.difficultyScore < 0.66) difficultyScoreBuckets.medium++;
      else difficultyScoreBuckets.high++;
    } catch (err) {
      results.push({ seed, validation: null, thrown: err instanceof Error ? err.message : String(err) });
    }
  }

  const validCount = results.filter((r) => r.validation?.valid).length;
  const thrownCount = results.filter((r) => r.thrown !== null).length;
  const invalidCount = results.length - validCount - thrownCount;
  const generatedCount = results.length - thrownCount;

  const solvabilityScores = results.map((r) => r.validation?.solvabilityScore ?? 0);
  const averageSolvability = solvabilityScores.reduce((a, b) => a + b, 0) / Math.max(1, solvabilityScores.length);

  const errorCounts = new Map<string, number>();
  for (const result of results) {
    for (const err of result.validation?.errors ?? []) {
      errorCounts.set(err, (errorCounts.get(err) ?? 0) + 1);
    }
    if (result.thrown) {
      errorCounts.set(result.thrown, (errorCounts.get(result.thrown) ?? 0) + 1);
    }
  }
  const commonErrors = [...errorCounts.entries()]
    .map(([message, count]) => ({ message, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  return {
    total: results.length,
    validCount,
    invalidCount,
    thrownCount,
    averageSolvability,
    commonErrors,
    results,
    averageSuspects: suspectsSum / Math.max(1, generatedCount),
    averageEvidenceCount: evidenceSum / Math.max(1, generatedCount),
    averageProofChannels: proofChannelsSum / Math.max(1, generatedCount),
    accompliceFrequency,
    stagingFrequency,
    falseConfessionFrequency: falseConfessionCount / Math.max(1, generatedCount),
    archetypeFrequency,
    methodFrequency,
    difficultyScoreBuckets,
  };
}
