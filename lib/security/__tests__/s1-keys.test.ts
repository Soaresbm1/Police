import { createHmac, randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  CASE_REF_KEY_INFO,
  deriveS1Keys,
  getS1Keys,
  parseMasterSecret,
  S1ConfigError,
  S1_MASTER_SECRET_ENV,
  SEED_ENCRYPTION_KEY_INFO,
} from "../s1-keys";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

/** Independent RFC 5869 HKDF-SHA-256 (extract with an all-zero salt, then
 * expand) — proves the derivation is the standard construction, not merely
 * self-consistent. */
function referenceHkdf(ikm: Buffer, info: string, length: number): Buffer {
  const prk = createHmac("sha256", Buffer.alloc(32)).update(ikm).digest();
  const blocks: Buffer[] = [];
  let previous = Buffer.alloc(0);
  for (let i = 1; Buffer.concat(blocks).length < length; i++) {
    previous = createHmac("sha256", prk).update(Buffer.concat([previous, Buffer.from(info, "utf8"), Buffer.from([i])])).digest();
    blocks.push(previous);
  }
  return Buffer.concat(blocks).subarray(0, length);
}

describe("S1 master secret parsing", () => {
  it("accepts a base64url secret of 32 bytes and the equivalent padded standard base64", () => {
    const raw = randomBytes(32);
    expect(parseMasterSecret(raw.toString("base64url")).equals(raw)).toBe(true);
    expect(parseMasterSecret(raw.toString("base64")).equals(raw)).toBe(true);
  });

  it("rejects secrets shorter than 32 bytes, non-base64 characters, and empty values", () => {
    for (const bad of [randomBytes(31).toString("base64url"), "not a secret!", "", "===="]) {
      expect(() => parseMasterSecret(bad)).toThrow(S1ConfigError);
    }
  });

  it("never echoes the secret value in its error message", () => {
    const bad = "short-but-sensitive-value";
    try {
      parseMasterSecret(bad);
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).not.toContain(bad);
      expect((err as S1ConfigError).code).toBe("S1_CONFIG_INVALID");
    }
  });
});

describe("S1 key derivation / domain separation", () => {
  it("derives each key with standard HKDF-SHA-256 under its own versioned info label", () => {
    const master = randomBytes(32);
    const keys = deriveS1Keys(master);
    expect(CASE_REF_KEY_INFO).toBe("caseline/s1/case-ref/v1");
    expect(SEED_ENCRYPTION_KEY_INFO).toBe("caseline/s1/seed-encryption/v1");
    expect(keys.caseRefKey.equals(referenceHkdf(master, CASE_REF_KEY_INFO, 32))).toBe(true);
    expect(keys.seedEncryptionKey.equals(referenceHkdf(master, SEED_ENCRYPTION_KEY_INFO, 32))).toBe(true);
  });

  it("never uses the raw master directly and never reuses one key for both purposes", () => {
    const master = randomBytes(32);
    const keys = deriveS1Keys(master);
    expect(keys.caseRefKey.length).toBe(32);
    expect(keys.seedEncryptionKey.length).toBe(32);
    expect(keys.caseRefKey.equals(keys.seedEncryptionKey)).toBe(false);
    expect(keys.caseRefKey.equals(master)).toBe(false);
    expect(keys.seedEncryptionKey.equals(master)).toBe(false);
  });

  it("is deterministic per master and different across masters", () => {
    const master = randomBytes(32);
    expect(deriveS1Keys(master).caseRefKey.equals(deriveS1Keys(Buffer.from(master)).caseRefKey)).toBe(true);
    expect(deriveS1Keys(master).caseRefKey.equals(deriveS1Keys(randomBytes(32)).caseRefKey)).toBe(false);
  });
});

describe("getS1Keys — configuration / fail-closed behavior", () => {
  it("derives from the configured secret", () => {
    const master = randomBytes(32);
    process.env[S1_MASTER_SECRET_ENV] = master.toString("base64url");
    expect(getS1Keys().caseRefKey.equals(deriveS1Keys(master).caseRefKey)).toBe(true);
  });

  it("fails closed with S1_CONFIG_MISSING when Supabase is configured but the secret is not", () => {
    delete process.env[S1_MASTER_SECRET_ENV];
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "publishable-test-key";
    expect(() => getS1Keys()).toThrow(S1ConfigError);
    try {
      getS1Keys();
    } catch (err) {
      expect((err as S1ConfigError).code).toBe("S1_CONFIG_MISSING");
    }
  });

  it("fails closed on an invalid configured secret even without Supabase", () => {
    process.env[S1_MASTER_SECRET_ENV] = "too-short";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    expect(() => getS1Keys()).toThrow(S1ConfigError);
  });

  it("uses stable per-process ephemeral keys only for the in-memory dev store (no secret, no Supabase)", () => {
    delete process.env[S1_MASTER_SECRET_ENV];
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    expect(getS1Keys().caseRefKey.equals(getS1Keys().caseRefKey)).toBe(true);
  });
});
