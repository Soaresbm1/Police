import { describe, expect, it } from "vitest";
import { RNG, createRootRng, generateCaseSeed, isValidCaseSeed } from "../random/rng";

describe("RNG", () => {
  it("is deterministic: same seed produces the same sequence", () => {
    const a = new RNG("hello");
    const b = new RNG("hello");
    const seqA = Array.from({ length: 20 }, () => a.float());
    const seqB = Array.from({ length: 20 }, () => b.float());
    expect(seqA).toEqual(seqB);
  });

  it("produces different sequences for different seeds", () => {
    const a = new RNG("seed-a");
    const b = new RNG("seed-b");
    const seqA = Array.from({ length: 20 }, () => a.float());
    const seqB = Array.from({ length: 20 }, () => b.float());
    expect(seqA).not.toEqual(seqB);
  });

  it("derive() produces stable, order-independent sub-streams", () => {
    const root1 = new RNG("case-x");
    const childA1 = root1.derive("population");
    root1.derive("relationships"); // draw something else in between
    const rootAgain = new RNG("case-x");
    const childA2 = rootAgain.derive("population");

    expect(childA1.float()).toBe(childA2.float());
  });

  it("int() stays within [min, max] inclusive over many draws", () => {
    const rng = new RNG("bounds-check");
    for (let i = 0; i < 500; i++) {
      const n = rng.int(3, 7);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(7);
    }
  });

  it("generateCaseSeed produces valid, unique-looking seeds", () => {
    const seeds = new Set(Array.from({ length: 50 }, () => generateCaseSeed()));
    for (const seed of seeds) {
      expect(isValidCaseSeed(seed)).toBe(true);
    }
    expect(seeds.size).toBe(50);
  });

  it("createRootRng is deterministic per case seed", () => {
    const rngA = createRootRng("CASE-ABCDEF");
    const rngB = createRootRng("CASE-ABCDEF");
    expect(rngA.derive("x").float()).toBe(rngB.derive("x").float());
  });
});
