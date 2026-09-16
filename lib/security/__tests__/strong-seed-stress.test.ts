import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateCase } from "@/lib/game-engine/case-generator/case-truth";
import { generateCaseSeed, isStrongCaseSeed } from "@/lib/game-engine/random/rng";
import type { CaseTruth, Difficulty } from "@/lib/game-engine/types/case";
import { validateCase } from "@/lib/game-engine/validator/case-validator";
import { computeCaseRef } from "../case-ref";
import { deriveS1Keys } from "../s1-keys";
import { openSessionSeed, sealSessionSeed } from "../seed-envelope";

/**
 * Security S1 §17 — 2,000 NEW-format cases, same generate/measure/discard
 * pattern as `reconstruction-stress.test.ts`. Also generates a same-size
 * batch of legacy-format seeds as the control group, so any structural or
 * validity regression attributable to the longer seed string would show up
 * as a divergence between the two populations. Reconstruction projection of
 * strong-format seeds (including its seed-leak counter) is exercised by
 * lib/game-engine/reconstruction/__tests__/reconstruction-stress.test.ts,
 * whose 2,000 cases come from generateCaseSeed() and so now use the new
 * format — projector imports are restricted to that subsystem by ESLint.
 */

const CASE_COUNT = 2000;
const STRESS_TIMEOUT_MS = 10 * 60 * 1000;
const DIFFICULTIES: Difficulty[] = ["recruit", "investigator", "inspector", "expert"];
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function randomLegacySeed(): string {
  let code = "";
  while (code.length < 6) {
    const byte = randomBytes(1)[0];
    if (byte < 252) code += ALPHABET[byte % 36];
  }
  return `CASE-${code}`;
}

function stableHash(truth: CaseTruth): string {
  const { generatedAt: _generatedAt, ...rest } = truth;
  void _generatedAt;
  return createHash("sha256").update(JSON.stringify(rest)).digest("hex");
}

function referenceErrors(truth: CaseTruth): number {
  const people = new Set(truth.people.map((p) => p.id));
  const locations = new Set(truth.locations.map((l) => l.id));
  let errors = 0;
  const person = (id: string | null) => (id === null || people.has(id) ? 0 : 1);
  const location = (id: string) => (locations.has(id) ? 0 : 1);
  errors += person(truth.victimId) + person(truth.culpritId) + location(truth.crimeLocationId);
  for (const id of [...truth.suspectIds, ...truth.accompliceIds]) errors += person(id);
  for (const event of truth.timeline) {
    errors += person(event.actorId) + location(event.locationId) + person(event.counterpartyId);
    for (const id of event.presentPersonIds) errors += person(id);
  }
  const evidenceIds = new Set<string>();
  for (const ev of truth.evidence) {
    if (evidenceIds.has(ev.id)) errors++;
    evidenceIds.add(ev.id);
    for (const id of ev.relatedPersonIds) errors += person(id);
    for (const id of ev.relatedLocationIds) errors += location(id);
  }
  return errors;
}

interface PopulationStats {
  thrown: number;
  invalid: number;
  referenceErrors: number;
  nondeterministic: number;
}

function runPopulation(seeds: string[], checkEnvelope: (seed: string) => void): PopulationStats {
  const stats: PopulationStats = { thrown: 0, invalid: 0, referenceErrors: 0, nondeterministic: 0 };
  seeds.forEach((seed, i) => {
    const difficulty = DIFFICULTIES[i % DIFFICULTIES.length];
    let truth: CaseTruth;
    try {
      truth = generateCase(seed, { difficulty });
    } catch {
      stats.thrown++;
      return;
    }
    if (stableHash(truth) !== stableHash(generateCase(seed, { difficulty }))) stats.nondeterministic++;
    if (!validateCase(truth).valid) stats.invalid++;
    stats.referenceErrors += referenceErrors(truth);
    checkEnvelope(seed);
  });
  return stats;
}

describe("S1 strong-seed stress batch (2,000 new-format cases + 2,000 legacy control)", () => {
  it(
    "0 generation failures, 0 duplicate seeds/caseRefs, 0 nondeterminism, no integrity regression vs legacy seeds",
    () => {
      const keys = deriveS1Keys(randomBytes(32));
      const strongSeeds = Array.from({ length: CASE_COUNT }, () => generateCaseSeed());
      const legacySeeds = Array.from({ length: CASE_COUNT }, () => randomLegacySeed());

      expect(strongSeeds.every(isStrongCaseSeed)).toBe(true);
      expect(new Set(strongSeeds).size).toBe(CASE_COUNT);
      expect(new Set(strongSeeds.map((seed) => computeCaseRef(seed, keys))).size).toBe(CASE_COUNT);

      let envelopeMismatches = 0;
      const strong = runPopulation(strongSeeds, (seed) => {
        if (openSessionSeed(sealSessionSeed(seed, "stress-user", keys), "stress-user", keys) !== seed) envelopeMismatches++;
      });
      const legacy = runPopulation(legacySeeds, () => {});

      console.log("[S1 stress] strong:", JSON.stringify(strong), "legacy control:", JSON.stringify(legacy));

      expect(strong.thrown).toBe(0);
      expect(strong.nondeterministic).toBe(0);
      expect(strong.referenceErrors).toBe(0);
      expect(envelopeMismatches).toBe(0);
      // Validity rates must match the legacy control within
      // sampling noise (both populations are ~98% valid pre-S1).
      expect(Math.abs(strong.invalid - legacy.invalid) / CASE_COUNT).toBeLessThan(0.02);
      expect(legacy.thrown).toBe(0);
      expect(legacy.nondeterministic).toBe(0);
      expect(legacy.referenceErrors).toBe(0);
    },
    STRESS_TIMEOUT_MS,
  );
});
