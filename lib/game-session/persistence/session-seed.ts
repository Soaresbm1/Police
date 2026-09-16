import "server-only";

import type { S1Keys } from "@/lib/security/s1-keys";
import { isSeedEnvelope, openSessionSeed, sealSessionSeed } from "@/lib/security/seed-envelope";
import type { GameSession } from "../types";

/**
 * Security S1 — bookkeeping between the logical `session.seed` (always the
 * plaintext `CASE-…` value, server-side only) and what is physically stored
 * in `investigation_sessions.seed` (an `s1e.v1.…` envelope).
 */

interface StoredSeedMemo {
  seed: string;
  stored: string;
}

/** Keyed by the in-memory session object a store handed out, so a later
 * save of that same object reuses its existing envelope instead of
 * re-encrypting (and changing the ciphertext) on every action. */
const storedSeeds = new WeakMap<GameSession, StoredSeedMemo>();

export function rememberStoredSeed(session: GameSession, stored: string): void {
  storedSeeds.set(session, { seed: session.seed, stored });
}

/** The value to persist for `session.seed`: the envelope already stored for
 * this exact logical seed when there is one, otherwise a fresh seal. Never
 * returns plaintext. */
export function storedSeedForSave(session: GameSession, userId: string, keys: S1Keys): string {
  const memo = storedSeeds.get(session);
  if (memo && memo.seed === session.seed && isSeedEnvelope(memo.stored)) return memo.stored;
  const stored = sealSessionSeed(session.seed, userId, keys);
  storedSeeds.set(session, { seed: session.seed, stored });
  return stored;
}

export interface SessionSeedColumnOps {
  /** `UPDATE investigation_sessions SET seed = next WHERE user_id = userId
   * AND seed = expected` touching no other column. Resolves true when a row
   * was updated, false when none matched, and rejects on a query error. */
  compareAndSwapSeed(userId: string, expected: string, next: string): Promise<boolean>;
  readStoredSeed(userId: string): Promise<string | null>;
}

export type LegacySeedUpgradeOutcome = "upgraded" | "already_upgraded" | "not_upgraded";

/**
 * Lazy migration of one pre-S1 row: replaces the plaintext legacy seed with
 * an envelope of the very same logical seed. Only the `seed` column is
 * written, and only while it still holds that plaintext, so it is
 * idempotent and safe against a concurrent load doing the same thing. No
 * other session state, no case generation, no `updated_at` bump.
 *
 * Never throws: on any failure the row simply stays plaintext and the next
 * load (or the next save, which always seals) tries again.
 */
export async function upgradeLegacySessionSeed(
  ops: SessionSeedColumnOps,
  userId: string,
  legacySeed: string,
  keys: S1Keys,
): Promise<{ outcome: LegacySeedUpgradeOutcome; stored: string }> {
  try {
    const envelope = sealSessionSeed(legacySeed, userId, keys);
    if (await ops.compareAndSwapSeed(userId, legacySeed, envelope)) return { outcome: "upgraded", stored: envelope };

    const current = await ops.readStoredSeed(userId);
    if (current && isSeedEnvelope(current) && openSessionSeed(current, userId, keys) === legacySeed) {
      return { outcome: "already_upgraded", stored: current };
    }
  } catch {
    // Reason intentionally not propagated: the caller logs a fixed code only.
  }
  return { outcome: "not_upgraded", stored: legacySeed };
}
