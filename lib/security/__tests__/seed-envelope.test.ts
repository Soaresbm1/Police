import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateCase } from "@/lib/game-engine/case-generator/case-truth";
import { generateCaseSeed } from "@/lib/game-engine/random/rng";
import { deriveS1Keys } from "../s1-keys";
import { openSessionSeed, resolveStoredSessionSeed, sealSessionSeed, SeedEnvelopeError, type SeedEnvelopeErrorCode } from "../seed-envelope";

const keys = deriveS1Keys(randomBytes(32));
const USER = "7d1f7e9a-1111-4a4a-9b9b-000000000001";
const OTHER_USER = "7d1f7e9a-1111-4a4a-9b9b-000000000002";

function codeOf(fn: () => unknown): SeedEnvelopeErrorCode | "NO_THROW" | "OTHER" {
  try {
    fn();
    return "NO_THROW";
  } catch (err) {
    return err instanceof SeedEnvelopeError ? err.code : "OTHER";
  }
}

function tamper(envelope: string, partIndex: number): string {
  const parts = envelope.split(".");
  const bytes = Buffer.from(parts[partIndex], "base64url");
  bytes[0] ^= 0x01;
  parts[partIndex] = bytes.toString("base64url");
  return parts.join(".");
}

describe("session seed envelope (AES-256-GCM)", () => {
  it("round-trips strong and legacy seeds exactly, and the envelope never contains the seed", () => {
    for (const seed of [generateCaseSeed(), "CASE-8J2X91"]) {
      const envelope = sealSessionSeed(seed, USER, keys);
      expect(envelope).toMatch(/^s1e\.v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$/);
      expect(envelope).not.toContain(seed);
      expect(envelope).not.toContain(seed.slice(5, 11));
      expect(openSessionSeed(envelope, USER, keys)).toBe(seed);
    }
  });

  it("uses a fresh random nonce: the same seed sealed twice gives different nonces and ciphertexts", () => {
    const seed = generateCaseSeed();
    const a = sealSessionSeed(seed, USER, keys);
    const b = sealSessionSeed(seed, USER, keys);
    expect(a).not.toBe(b);
    expect(a.split(".")[2]).not.toBe(b.split(".")[2]);
    expect(a.split(".")[3]).not.toBe(b.split(".")[3]);
    const nonces = new Set(Array.from({ length: 200 }, () => sealSessionSeed(seed, USER, keys).split(".")[2]));
    expect(nonces.size).toBe(200);
  });

  it("binds the ciphertext to the owning user (AAD): another user's context fails authentication", () => {
    const envelope = sealSessionSeed(generateCaseSeed(), USER, keys);
    expect(codeOf(() => openSessionSeed(envelope, OTHER_USER, keys))).toBe("AUTHENTICATION_FAILED");
  });

  it("fails authentication under a different key", () => {
    const envelope = sealSessionSeed(generateCaseSeed(), USER, keys);
    expect(codeOf(() => openSessionSeed(envelope, USER, deriveS1Keys(randomBytes(32))))).toBe("AUTHENTICATION_FAILED");
  });

  it("detects tampering with the nonce, ciphertext or tag", () => {
    const envelope = sealSessionSeed(generateCaseSeed(), USER, keys);
    for (const part of [2, 3, 4]) {
      expect(codeOf(() => openSessionSeed(tamper(envelope, part), USER, keys))).toBe("AUTHENTICATION_FAILED");
    }
  });

  it("fails closed on malformed envelopes", () => {
    const valid = sealSessionSeed(generateCaseSeed(), USER, keys);
    const [prefix, version, nonce, ct, tag] = valid.split(".");
    const malformed = [
      "s1e.",
      "s1e.v1",
      "s1e.v1...",
      `${prefix}.${version}.${nonce}.${ct}`,
      `${prefix}.${version}.${nonce}.${ct}.${tag}.extra`,
      `${prefix}.${version}.${nonce.slice(1)}.${ct}.${tag}`,
      `${prefix}.${version}.${nonce}.${ct}.${tag.slice(1)}`,
      `${prefix}.${version}.${nonce}.${ct}+.${tag}`,
      `${prefix}.${version}.${nonce}.${ct}.${tag}=`,
      `${prefix}.vX.${nonce}.${ct}.${tag}`,
      " " + valid,
    ];
    for (const bad of malformed) {
      expect(["MALFORMED", "AUTHENTICATION_FAILED"]).toContain(codeOf(() => openSessionSeed(bad, USER, keys)));
    }
    expect(codeOf(() => openSessionSeed(`${prefix}.${version}.${nonce}.${ct}`, USER, keys))).toBe("MALFORMED");
  });

  it("fails closed on an unknown envelope version", () => {
    const valid = sealSessionSeed(generateCaseSeed(), USER, keys);
    expect(codeOf(() => openSessionSeed(valid.replace("s1e.v1.", "s1e.v2."), USER, keys))).toBe("UNSUPPORTED_VERSION");
  });

  it("refuses to seal anything that is not a canonical seed", () => {
    for (const bad of ["", "hello", "cr1_" + "a".repeat(32), "s1e.v1.x", "CASE-abc123"]) {
      expect(codeOf(() => sealSessionSeed(bad, USER, keys))).toBe("INVALID_PLAINTEXT");
    }
  });

  it("an envelope is never usable as seed material", () => {
    const envelope = sealSessionSeed(generateCaseSeed(), USER, keys);
    expect(() => generateCase(envelope)).toThrow(/reserved non-seed token/);
  });
});

describe("resolveStoredSessionSeed", () => {
  it("decrypts an envelope", () => {
    const seed = generateCaseSeed();
    expect(resolveStoredSessionSeed(sealSessionSeed(seed, USER, keys), USER, keys)).toEqual({ seed, kind: "envelope" });
  });

  it("accepts a pre-S1 plaintext legacy seed (awaiting lazy migration) without needing keys", () => {
    expect(resolveStoredSessionSeed("CASE-TEST01", USER)).toEqual({ seed: "CASE-TEST01", kind: "legacy_plaintext" });
  });

  it("rejects a bare strong-format seed (no S1 path ever stores one) and any other value", () => {
    for (const bad of [generateCaseSeed(), "", "garbage", "cr1_" + "0".repeat(32)]) {
      expect(codeOf(() => resolveStoredSessionSeed(bad, USER, keys))).toBe("UNRECOGNIZED_STORED_SEED");
    }
  });
});
