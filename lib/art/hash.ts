/**
 * Deterministic string hashing shared by every procedural art generator
 * under `lib/art/` (and the portrait service) — the same seed must always
 * produce the same visual, and unrelated seeds should spread across the
 * output range without every caller reimplementing its own hash.
 */
export function hashSeed(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function hashToHue(seed: string): number {
  return hashSeed(seed) % 360;
}

/** Deterministically picks one option from a list, keyed by seed. */
export function pick<T>(seed: string, options: readonly T[]): T {
  if (options.length === 0) throw new Error("pick() requires at least one option");
  return options[hashSeed(seed) % options.length];
}

/** Deterministically picks an integer in [min, max] (inclusive), keyed by seed. */
export function pickRange(seed: string, min: number, max: number): number {
  if (max <= min) return min;
  return min + (hashSeed(seed) % (max - min + 1));
}

/** Deterministically picks true/false with the given probability of true. */
export function pickChance(seed: string, probability: number): boolean {
  return (hashSeed(seed) % 1000) / 1000 < probability;
}
