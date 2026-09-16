import "server-only";

import { hkdfSync, randomBytes } from "node:crypto";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/**
 * Security S1 — key material for everything that must stay opaque to a
 * player during an unresolved case (see SECURITY.md).
 *
 * One master secret (`CASELINE_S1_MASTER_SECRET`, server-only, never
 * `NEXT_PUBLIC_`) is never used directly. HKDF-SHA-256 derives one
 * independent 256-bit key per purpose, each bound to its own versioned
 * `info` label, so the case-reference HMAC key and the seed-encryption key
 * can never be confused with each other or with the raw master:
 *
 *   caseline/s1/case-ref/v1         → HMAC-SHA-256 key (lib/security/case-ref.ts)
 *   caseline/s1/seed-encryption/v1  → AES-256-GCM key (lib/security/seed-envelope.ts)
 *
 * Preview and Production share one Supabase project, so both environments
 * MUST carry the same master secret — a different one would make every
 * encrypted session unreadable on the other side.
 */

export const S1_MASTER_SECRET_ENV = "CASELINE_S1_MASTER_SECRET";
export const CASE_REF_KEY_INFO = "caseline/s1/case-ref/v1";
export const SEED_ENCRYPTION_KEY_INFO = "caseline/s1/seed-encryption/v1";

const MIN_MASTER_SECRET_BYTES = 32;
const DERIVED_KEY_BYTES = 32;

export interface S1Keys {
  caseRefKey: Buffer;
  seedEncryptionKey: Buffer;
}

export type S1ConfigErrorCode = "S1_CONFIG_MISSING" | "S1_CONFIG_INVALID";

/** Thrown whenever S1 key material is required but unusable. The message
 * names the variable, never its value or any derived material. */
export class S1ConfigError extends Error {
  constructor(readonly code: S1ConfigErrorCode) {
    super(
      code === "S1_CONFIG_MISSING"
        ? `[CASELINE] [S1] ${S1_MASTER_SECRET_ENV} is not configured — refusing to read or write protected case data.`
        : `[CASELINE] [S1] ${S1_MASTER_SECRET_ENV} is invalid (expected base64/base64url of at least ${MIN_MASTER_SECRET_BYTES} random bytes).`,
    );
    this.name = "S1ConfigError";
  }
}

/** Decodes the configured master secret. Accepts base64url or standard
 * base64 (padding optional) and rejects anything that is not a canonical
 * encoding of at least 32 bytes. */
export function parseMasterSecret(raw: string): Buffer {
  const normalized = raw.trim().replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  if (!/^[A-Za-z0-9_-]+$/.test(normalized)) throw new S1ConfigError("S1_CONFIG_INVALID");
  const bytes = Buffer.from(normalized, "base64url");
  if (bytes.toString("base64url") !== normalized || bytes.length < MIN_MASTER_SECRET_BYTES) {
    throw new S1ConfigError("S1_CONFIG_INVALID");
  }
  return bytes;
}

/** HKDF-SHA-256 (RFC 5869) with an empty salt — the master is already
 * uniformly random, so domain separation comes entirely from `info`. */
export function deriveS1Keys(master: Uint8Array): S1Keys {
  const derive = (info: string) => Buffer.from(hkdfSync("sha256", master, Buffer.alloc(0), info, DERIVED_KEY_BYTES));
  return { caseRefKey: derive(CASE_REF_KEY_INFO), seedEncryptionKey: derive(SEED_ENCRYPTION_KEY_INFO) };
}

let cached: { raw: string; keys: S1Keys } | null = null;
let ephemeralDevKeys: S1Keys | null = null;

/**
 * The keys every S1 call site uses by default.
 *
 * - Secret configured → keys derived from it (memoized per value).
 * - No secret AND no Supabase → the in-memory dev store is in use, whose
 *   state dies with this process anyway: a random per-process master keeps
 *   case references deterministic for exactly that lifetime.
 * - No secret but Supabase configured (Preview/Production, or local dev
 *   pointed at the shared project) → fail closed with `S1ConfigError`.
 */
export function getS1Keys(): S1Keys {
  const raw = process.env[S1_MASTER_SECRET_ENV];
  if (raw && raw.trim() !== "") {
    if (cached?.raw !== raw) cached = { raw, keys: deriveS1Keys(parseMasterSecret(raw)) };
    return cached.keys;
  }
  if (!isSupabaseConfigured()) {
    ephemeralDevKeys ??= deriveS1Keys(randomBytes(DERIVED_KEY_BYTES));
    return ephemeralDevKeys;
  }
  throw new S1ConfigError("S1_CONFIG_MISSING");
}
