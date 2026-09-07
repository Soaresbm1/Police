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

  /** Archives a finished case and updates the profile's career stats
   * (rank/XP/solved/failed/accusations) in one call, so the two can never
   * drift out of sync. Returns the updated profile. */
  completeCase(userId: string, entry: Omit<CaseHistoryEntry, "id" | "completedAt">): Promise<PlayerProfile>;
  listCaseHistory(userId: string): Promise<CaseHistoryEntry[]>;
  getCaseHistoryEntry(userId: string, entryId: string): Promise<CaseHistoryEntry | null>;
}
