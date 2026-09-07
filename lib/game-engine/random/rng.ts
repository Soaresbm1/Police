/**
 * Deterministic pseudo-random number generator.
 *
 * The whole case-generation pipeline depends on this: the same CaseSeed must
 * always produce the exact same CaseTruth, forever, regardless of what other
 * random calls exist elsewhere in the code. To keep that guarantee robust
 * across future code changes, callers should not share a single RNG stream
 * across unrelated generation steps — instead they call `.derive(label)` to
 * fork an independent, order-insensitive sub-stream for each concern
 * (e.g. rng.derive("population"), rng.derive("relationships")).
 */

// cyrb128: deterministically hashes an arbitrary string into 4 32-bit ints.
function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

// sfc32: small, fast, statistically solid 32-bit PRNG core.
function sfc32(a: number, b: number, c: number, d: number): () => number {
  return function next() {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

export class RNG {
  private readonly next: () => number;
  private readonly streamId: string;
  private callCount = 0;

  constructor(seedMaterial: string) {
    this.streamId = seedMaterial;
    const [a, b, c, d] = cyrb128(seedMaterial);
    this.next = sfc32(a, b, c, d);
    // Warm up the generator; the first few outputs of sfc32 can be weakly
    // correlated with the seed for some seed values.
    for (let i = 0; i < 12; i++) this.next();
  }

  /** Creates an independent child stream. Order-of-call-safe: two callers
   * deriving the same label always get the same stream, regardless of what
   * else has been drawn from the parent. */
  derive(label: string): RNG {
    return new RNG(`${this.streamId}::${label}`);
  }

  /** Uniform float in [0, 1). */
  float(): number {
    this.callCount++;
    return this.next();
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + this.float() * (max - min);
  }

  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  /** Bernoulli trial: true with probability p (0-1). */
  bool(p = 0.5): boolean {
    return this.float() < p;
  }

  /** Picks a uniformly random element from a non-empty array. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new Error("RNG.pick called with an empty array");
    }
    return items[this.int(0, items.length - 1)];
  }

  /** Picks an element using relative weights. Weights must be >= 0 and sum > 0. */
  pickWeighted<T>(items: readonly { item: T; weight: number }[]): T {
    const total = items.reduce((sum, entry) => sum + entry.weight, 0);
    if (total <= 0) {
      throw new Error("RNG.pickWeighted requires a positive total weight");
    }
    let roll = this.float() * total;
    for (const entry of items) {
      roll -= entry.weight;
      if (roll <= 0) return entry.item;
    }
    return items[items.length - 1].item;
  }

  /** Fisher-Yates shuffle; returns a new array, does not mutate the input. */
  shuffle<T>(items: readonly T[]): T[] {
    const result = items.slice();
    for (let i = result.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  /** Picks `count` distinct elements without replacement. */
  sample<T>(items: readonly T[], count: number): T[] {
    if (count > items.length) {
      throw new Error("RNG.sample: count exceeds population size");
    }
    return this.shuffle(items).slice(0, count);
  }

  /** Deterministic id, unique within this stream instance. */
  id(prefix: string): string {
    this.callCount++;
    const [a] = cyrb128(`${this.streamId}::id::${this.callCount}::${prefix}`);
    return `${prefix}_${a.toString(36)}`;
  }
}

const SEED_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Generates a fresh, human-shareable case seed, e.g. "CASE-8J2X91". */
export function generateCaseSeed(): string {
  const bytes = new Uint32Array(6);
  crypto.getRandomValues(bytes);
  const code = Array.from(bytes, (b) => SEED_ALPHABET[b % SEED_ALPHABET.length]).join("");
  return `CASE-${code}`;
}

/** Validates the canonical case seed format. */
export function isValidCaseSeed(seed: string): boolean {
  return /^CASE-[0-9A-Z]{6}$/.test(seed);
}

/** Creates the root RNG for a given case seed. All case generation must derive from this. */
export function createRootRng(seed: string): RNG {
  return new RNG(`caseline::${seed}`);
}
