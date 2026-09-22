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

/** Security S2 EXPAND-2 — true only when the currently-remembered stored
 * value for this exact logical seed is already a valid `s1e.v1...`
 * envelope. `saveSession` uses this to skip the reseal fallback entirely in
 * the common case (nothing to reseal) and only attempt
 * `caseline_reseal_seed` when a legacy plaintext value is still on record
 * (the load-time upgrade attempt failed under contention). */
export function isAlreadySealed(session: GameSession): boolean {
  const memo = storedSeeds.get(session);
  return memo !== undefined && memo.seed === session.seed && isSeedEnvelope(memo.stored);
}

/** The raw value currently on record for this session object (whatever
 * `rememberStoredSeed` last saw) — used as the CAS `expected` value for a
 * reseal fallback attempt. `undefined` if nothing has been remembered yet
 * for this exact logical seed. */
export function currentStoredSeed(session: GameSession): string | undefined {
  const memo = storedSeeds.get(session);
  return memo && memo.seed === session.seed ? memo.stored : undefined;
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
  /** Security S2 EXPAND-2 — compare-and-swaps the `seed` column only,
   * scoped to both `userId` and `sessionUuid` (never touches any other
   * column). Routes through `caseline_reseal_seed` in the Supabase
   * implementation (capability-gated — see that migration's own doc
   * comment for why a plain authenticated compare-and-swap isn't safe
   * here) rather than a direct `.update()`. Resolves true when the swap
   * applied, false when `expected` no longer matched (a concurrent
   * reseal already won, or this is a stale retry), and rejects on a
   * genuine query error. */
  compareAndSwapSeed(userId: string, sessionUuid: string, expected: string, next: string): Promise<boolean>;
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
  sessionUuid: string,
  legacySeed: string,
  keys: S1Keys,
): Promise<{ outcome: LegacySeedUpgradeOutcome; stored: string }> {
  try {
    const envelope = sealSessionSeed(legacySeed, userId, keys);
    if (await ops.compareAndSwapSeed(userId, sessionUuid, legacySeed, envelope)) return { outcome: "upgraded", stored: envelope };

    const current = await ops.readStoredSeed(userId);
    if (current && isSeedEnvelope(current) && openSessionSeed(current, userId, keys) === legacySeed) {
      return { outcome: "already_upgraded", stored: current };
    }
  } catch {
    // Reason intentionally not propagated: the caller logs a fixed code only.
  }
  return { outcome: "not_upgraded", stored: legacySeed };
}
