import { afterEach, describe, expect, it, vi } from "vitest";
import { generateCase } from "@/lib/game-engine/case-generator/case-truth";
import {
  generateCaseSeed,
  isLegacyCaseSeed,
  isReservedNonSeedToken,
  isStrongCaseSeed,
  isValidCaseSeed,
  STRONG_CASE_SEED_ENTROPY_BITS,
} from "@/lib/game-engine/random/rng";

afterEach(() => {
  vi.restoreAllMocks();
});

function stableTruth(seed: string) {
  const { generatedAt: _generatedAt, ...rest } = generateCase(seed, { difficulty: "investigator" });
  void _generatedAt;
  return JSON.stringify(rest);
}

describe("strong case seeds (Security S1)", () => {
  it("new seeds use the 5×5 base-36 format carrying ≈129.25 bits of entropy", () => {
    expect(STRONG_CASE_SEED_ENTROPY_BITS).toBeCloseTo(25 * Math.log2(36), 10);
    expect(STRONG_CASE_SEED_ENTROPY_BITS).toBeGreaterThanOrEqual(128);
    for (let i = 0; i < 200; i++) {
      const seed = generateCaseSeed();
      expect(seed).toMatch(/^CASE-[0-9A-Z]{5}(-[0-9A-Z]{5}){4}$/);
      expect(isStrongCaseSeed(seed)).toBe(true);
      expect(isLegacyCaseSeed(seed)).toBe(false);
      expect(isValidCaseSeed(seed)).toBe(true);
    }
  });

  it("draws from crypto.getRandomValues and never Math.random", () => {
    const cryptoSpy = vi.spyOn(globalThis.crypto, "getRandomValues");
    const mathSpy = vi.spyOn(Math, "random");
    generateCaseSeed();
    expect(cryptoSpy).toHaveBeenCalled();
    expect(mathSpy).not.toHaveBeenCalled();
  });

  it("is unbiased: bytes 252-255 are rejected and every accepted byte maps to exactly one of 36 equally-weighted characters", () => {
    // The accepted range 0..251 is exactly 7 × 36, so byte % 36 is uniform.
    const weights = new Map<number, number>();
    for (let b = 0; b < 252; b++) weights.set(b % 36, (weights.get(b % 36) ?? 0) + 1);
    expect(weights.size).toBe(36);
    expect(new Set(weights.values())).toEqual(new Set([7]));

    // A buffer that starts with the four rejectable bytes, then 0,1,2,…:
    // the seed must skip 252-255 and consume the next 25 bytes in order.
    vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(<T extends ArrayBufferView | null>(array: T): T => {
      const view = array as unknown as Uint8Array;
      const pattern = [252, 253, 254, 255];
      for (let i = 0; i < view.length; i++) view[i] = i < pattern.length ? pattern[i] : i - pattern.length;
      return array;
    });
    expect(generateCaseSeed()).toBe("CASE-01234-56789-ABCDE-FGHIJ-KLMNO");
  });

  it("old CASE-XXXXXX seeds remain valid; malformed and reserved values do not", () => {
    expect(isValidCaseSeed("CASE-8J2X91")).toBe(true);
    expect(isLegacyCaseSeed("CASE-8J2X91")).toBe(true);
    for (const bad of ["CASE-8j2x91", "CASE-8J2X9", "CASE-ABCDE-ABCDE-ABCDE-ABCDE", "cr1_" + "0".repeat(32), "s1e.v1.a.b.c"]) {
      expect(isValidCaseSeed(bad)).toBe(false);
    }
    expect(isReservedNonSeedToken("cr1_abc")).toBe(true);
    expect(isReservedNonSeedToken("s1e.v1.abc")).toBe(true);
    expect(isReservedNonSeedToken("CASE-8J2X91")).toBe(false);
  });

  it("generateCase is deterministic for a strong-format seed", () => {
    const seed = generateCaseSeed();
    expect(stableTruth(seed)).toBe(stableTruth(seed));
    expect(generateCase(seed).seed).toBe(seed);
  });

  it("historical legacy seeds still regenerate the same case (identity pinned from pre-S1 master e9ffa53)", () => {
    // Values captured on e9ffa53 before any S1 change. The full byte-level
    // comparison (400 seeds × 4 difficulties, CaseTruth + reconstruction
    // hashes) is part of the S1 validation report; these pin case identity.
    const truth = generateCase("CASE-8J2X91", { difficulty: "investigator" });
    expect(truth.seed).toBe("CASE-8J2X91");
    expect(generateCase("CASE-8J2X91", { difficulty: "investigator" }).culpritId).toBe(truth.culpritId);
    expect(LEGACY_IDENTITY_FIXTURE).toEqual(
      Object.fromEntries(
        Object.keys(LEGACY_IDENTITY_FIXTURE).map((seed) => {
          const t = generateCase(seed, { difficulty: "investigator" });
          return [seed, { victimId: t.victimId, culpritId: t.culpritId, crimeLocationId: t.crimeLocationId, methodType: t.methodType }];
        }),
      ),
    );
  });
});

const LEGACY_IDENTITY_FIXTURE: Record<string, { victimId: string; culpritId: string; crimeLocationId: string; methodType: string }> = {
  "CASE-DG83V3": { victimId: "person_15opcnz", culpritId: "person_1fu1h6i", crimeLocationId: "loc_1ov3dob", methodType: "blunt_force" },
  "CASE-FOWQ1C": { victimId: "person_xo9a5t", culpritId: "person_jzuiol", crimeLocationId: "loc_2wefrl", methodType: "firearm" },
  "CASE-67P3IE": { victimId: "person_1ell3ef", culpritId: "person_lybq4p", crimeLocationId: "loc_1ojum0g", methodType: "blunt_force" },
  "CASE-Q7YKPN": { victimId: "person_o7sr4t", culpritId: "person_8md6x6", crimeLocationId: "loc_1rona1n", methodType: "stabbing" },
  "CASE-YKS1GG": { victimId: "person_1onjt2o", culpritId: "person_1je6mep", crimeLocationId: "loc_1498fiu", methodType: "fall_push" },
  "CASE-52WGII": { victimId: "person_2r70dl", culpritId: "person_1gd9xpf", crimeLocationId: "loc_14ojrwz", methodType: "fall_push" },
};
