import { generateCase } from "../../case-generator/case-truth";
import type { CaseTruth, Difficulty } from "../../types/case";

/**
 * Phase U5.1 — TEST/DEV ONLY. Finds a generated case matching the U5.0 §25
 * recommended first proof-of-concept criteria (crime_of_opportunity,
 * non-premeditated, blunt_force or strangulation, no staging, zero
 * accomplices — the smallest-actor-count, no-cosmetic-inference-needed
 * shape). Never imported by any production page, Server Action, or API
 * route — this file lives under `__tests__/` and does not end in
 * `.test.ts`, so vitest's own `include` glob (`lib/**\/*.test.ts`) never
 * picks it up as a test either; it exists purely as a fixture helper for
 * the tests that do.
 *
 * Uses a deterministic candidate-seed sequence (not `generateCaseSeed()`,
 * which is crypto-random) so this helper's own result is reproducible
 * across test runs, matching this phase's no-`Math.random()` discipline
 * even in test tooling.
 */

function candidateSeed(index: number): string {
  const code = index.toString(36).toUpperCase().padStart(6, "0").slice(-6);
  return `CASE-${code}`;
}

export interface PocCaseMatch {
  seed: string;
  difficulty: Difficulty;
  truth: CaseTruth;
}

export function findPocCase(maxAttempts = 2000, difficulty: Difficulty = "investigator"): PocCaseMatch | null {
  for (let i = 0; i < maxAttempts; i++) {
    const seed = candidateSeed(i);
    const truth = generateCase(seed, { difficulty });
    const matches =
      truth.archetype === "crime_of_opportunity" &&
      truth.premeditated === false &&
      (truth.methodType === "blunt_force" || truth.methodType === "strangulation") &&
      truth.staging.type === "none" &&
      truth.accomplices.length === 0;
    if (matches) {
      return { seed, difficulty, truth };
    }
  }
  return null;
}
