import type { Difficulty } from "../types/case";
import { generateCaseSeed } from "../random/rng";
import { generateCase } from "./case-truth";
import { validateCase, type ValidationResult } from "../validator/case-validator";

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
}

/** Generates `count` fresh cases and validates each, for statistically
 * hunting down rare generator bugs. Dev/test tool only — never called from
 * production gameplay code. */
export function generateBatch(count: number, difficulty?: Difficulty): BatchSummary {
  const results: BatchCaseResult[] = [];

  for (let i = 0; i < count; i++) {
    const seed = generateCaseSeed();
    try {
      const truth = generateCase(seed, { difficulty });
      const validation = validateCase(truth);
      results.push({ seed, validation, thrown: null });
    } catch (err) {
      results.push({ seed, validation: null, thrown: err instanceof Error ? err.message : String(err) });
    }
  }

  const validCount = results.filter((r) => r.validation?.valid).length;
  const thrownCount = results.filter((r) => r.thrown !== null).length;
  const invalidCount = results.length - validCount - thrownCount;

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

  return { total: results.length, validCount, invalidCount, thrownCount, averageSolvability, commonErrors, results };
}
