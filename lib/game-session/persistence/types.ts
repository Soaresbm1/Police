import type { Difficulty } from "@/lib/game-engine/types/case";
import type { Accusation, GameSession } from "../types";
import type { CaseScore } from "../scoring";

export interface PlayerSettings {
  soundMuted: boolean;
  reduceMotion: boolean;
  hintsDisabled: boolean;
}

export interface PlayerProfile {
  userId: string;
  displayName: string;
  rank: string;
  xp: number;
  casesSolved: number;
  casesFailed: number;
  accusationsTotal: number;
  settings: PlayerSettings;
}

export interface CaseHistoryEntry {
  id: string;
  seed: string;
  difficulty: Difficulty;
  accusation: Accusation;
  score: CaseScore;
  completedAt: number;
}

/** Security S2 — the only allowed time deltas, matching the actual UI
 * buttons (components/shell/TopBar.tsx) exactly. Shared by both
 * `SessionStore` implementations and the app-level `advanceTimeAction`,
 * so the allow-list is defined once. */
export const ALLOWED_TIME_DELTAS = [30, 60, 240] as const;
export type AllowedTimeDelta = (typeof ALLOWED_TIME_DELTAS)[number];

/** Security S2 — everything `finalizeCase` needs to persist one case
 * resolution atomically. `xpGained`/`culpritCorrect` are computed
 * server-side (career.ts#xpForCase, scoring.ts#scoreAccusation's own
 * result) by the caller before this is ever invoked — never accepted
 * from a client input. */
export interface FinalizeCaseInput {
  seed: string;
  difficulty: Difficulty;
  accusation: Accusation;
  score: CaseScore;
  xpGained: number;
  culpritCorrect: boolean;
}

export interface FinalizeCaseResult {
  historyId: string;
  /** True when a prior call (a race winner, or a genuine retry) already
   * finalized this exact investigation instance — the caller must treat
   * this as a harmless no-op, never re-apply the reward. */
  alreadyFinalized: boolean;
  profile: PlayerProfile;
}

/**
 * Everything the game reads or writes for one player, behind one interface
 * with two implementations (`memory-store.ts` for local/dev,
 * `supabase-store.ts` for real persistence — picked by
 * `lib/supabase/config.ts#isSupabaseConfigured`). Nothing in this interface
 * can express storing a `CaseTruth` — every method only takes/returns a
 * seed, a player's own play state, or a previously-computed score.
 */
export interface SessionStore {
  getActiveSession(userId: string): Promise<GameSession | null>;
  createSession(userId: string, seed: string, difficulty: Difficulty, crimeTimestamp: number): Promise<GameSession>;
  saveSession(userId: string, session: GameSession): Promise<void>;
  deleteActiveSession(userId: string): Promise<void>;

  getProfile(userId: string): Promise<PlayerProfile>;
  updateSettings(userId: string, patch: Partial<PlayerSettings>): Promise<PlayerProfile>;

  /** Security S2 — the game clock's only sanctioned direct mutation path.
   * `sessionUuid` must match the caller's own active session; the delta
   * must be one of `ALLOWED_TIME_DELTAS`. Returns the new absolute time.
   * `MemoryStore` enforces the same allow-list for dev/test parity even
   * though it has no real security boundary to protect. */
  advanceTime(userId: string, sessionUuid: string, minutes: AllowedTimeDelta): Promise<number>;

  /** Security S2 — one atomic, idempotent case resolution: persists the
   * accusation, archives exactly one `case_history` row, and updates
   * profile progression, or (if `sessionUuid` was already finalized)
   * changes nothing and reports `alreadyFinalized: true`. Replaces the
   * old two-step `completeCase` (separate history-insert + profile-update,
   * with no protection against a double-submit racing both). */
  finalizeCase(userId: string, sessionUuid: string, input: FinalizeCaseInput): Promise<FinalizeCaseResult>;

  listCaseHistory(userId: string): Promise<CaseHistoryEntry[]>;
  getCaseHistoryEntry(userId: string, entryId: string): Promise<CaseHistoryEntry | null>;
}
