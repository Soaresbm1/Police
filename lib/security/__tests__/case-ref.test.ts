import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateCase } from "@/lib/game-engine/case-generator/case-truth";
import { generateCaseSeed } from "@/lib/game-engine/random/rng";
import { formatCaseNumber } from "@/lib/game-engine/world/city";
import { caseAssetKeysFor, computeCaseRef, isCaseRef } from "../case-ref";
import { deriveS1Keys } from "../s1-keys";
import { displayCaseNumber } from "../case-number";

const keys = deriveS1Keys(randomBytes(32));
const LEGACY = "CASE-8J2X91";

describe("caseRef", () => {
  it("is deterministic for the same logical seed and key", () => {
    const seed = generateCaseSeed();
    expect(computeCaseRef(seed, keys)).toBe(computeCaseRef(seed, keys));
  });

  it("differs across different seeds and across different secrets", () => {
    const refs = new Set(Array.from({ length: 500 }, () => computeCaseRef(generateCaseSeed(), keys)));
    expect(refs.size).toBe(500);
    expect(computeCaseRef(LEGACY, keys)).not.toBe(computeCaseRef(LEGACY, deriveS1Keys(randomBytes(32))));
  });

  it("has the versioned, storage-path-safe cr1_ + 128-bit hex format and contains no seed material", () => {
    for (const seed of [LEGACY, generateCaseSeed()]) {
      const ref = computeCaseRef(seed, keys);
      expect(ref).toMatch(/^cr1_[0-9a-f]{32}$/);
      expect(isCaseRef(ref)).toBe(true);
      expect(ref).not.toContain(seed);
      expect(ref.toUpperCase()).not.toContain(seed.replace("CASE-", ""));
    }
    expect(isCaseRef(LEGACY)).toBe(false);
    expect(isCaseRef("cr2_" + "0".repeat(32))).toBe(false);
  });

  it("is never accepted as a seed — generateCase and computeCaseRef both refuse it", () => {
    const ref = computeCaseRef(LEGACY, keys);
    expect(() => generateCase(ref)).toThrow(/reserved non-seed token/);
    expect(() => computeCaseRef(ref, keys)).toThrow();
  });

  it("asset lookup keys include the plaintext seed only for a legacy case", () => {
    expect(caseAssetKeysFor(LEGACY, keys).lookupKeys).toEqual([computeCaseRef(LEGACY, keys), LEGACY]);
    const strong = generateCaseSeed();
    expect(caseAssetKeysFor(strong, keys).lookupKeys).toEqual([computeCaseRef(strong, keys)]);
  });
});

describe("displayCaseNumber (S1 case-number decision)", () => {
  it("keeps every legacy case's historical number unchanged", () => {
    expect(displayCaseNumber(LEGACY)).toBe(formatCaseNumber(LEGACY));
  });

  it("derives a strong-format case's number from its keyed caseRef, not from the seed", () => {
    const seed = generateCaseSeed();
    process.env.CASELINE_S1_MASTER_SECRET = randomBytes(32).toString("base64url");
    try {
      const shown = displayCaseNumber(seed);
      expect(shown).toBe(formatCaseNumber(computeCaseRef(seed)));
      expect(shown).toMatch(/^[A-Z]+-\d{4}-\d{4}$/);
      expect(displayCaseNumber(seed)).toBe(shown); // stable per case
    } finally {
      delete process.env.CASELINE_S1_MASTER_SECRET;
    }
  });
});
