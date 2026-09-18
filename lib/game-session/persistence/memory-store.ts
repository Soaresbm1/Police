import type { Difficulty } from "@/lib/game-engine/types/case";
import type { GameSession } from "../types";
import { applyCaseToCareer } from "../career";
import { ALLOWED_TIME_DELTAS, type AllowedTimeDelta, type CaseHistoryEntry, type FinalizeCaseInput, type FinalizeCaseResult, type PlayerProfile, type PlayerSettings, type SessionStore } from "./types";

function randomId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function freshSession(userId: string, seed: string, difficulty: Difficulty, crimeTimestamp: number): GameSession {
  return {
    id: userId,
    sessionUuid: randomId("session"),
    seed,
    difficulty,
    createdAt: Date.now(),
    currentTime: crimeTimestamp,
    evidenceStatus: {},
    labQueue: [],
    events: [],
    notes: "",
    playerTimeline: [],
    interrogated: {},
    mandates: {},
    surveillance: {},
    board: { nodes: [], edges: [] },
    accusation: null,
    crimeSceneExamined: false,
    crimeSceneInspectedZoneIds: [],
    lastRevealedEvidenceIds: [],
    lastActionMessage: null,
    hintState: { progress: {}, history: [], totalHintsUsed: 0 },
  };
}

function freshProfile(userId: string): PlayerProfile {
  return {
    userId,
    displayName: "",
    rank: "Recrue",
    xp: 0,
    casesSolved: 0,
    casesFailed: 0,
    accusationsTotal: 0,
    settings: { soundMuted: false, reduceMotion: false, hintsDisabled: false },
  };
}

/**
 * In-memory implementation used whenever Supabase isn't configured (see
 * `lib/supabase/config.ts`). Same documented limitation as the original
 * Phase 6 store it replaces: state lives only as long as this Node
 * process. `getStore()` hands out a single shared instance so dev behavior
 * is unchanged from before Phase 9.
 */
export class MemoryStore implements SessionStore {
  private sessions = new Map<string, GameSession>();
  private profiles = new Map<string, PlayerProfile>();
  private history = new Map<string, CaseHistoryEntry[]>();
  /** Security S2 parity — mirrors the `case_history` partial unique index
   * on `source_session_uuid`, so a double-submit can't double-reward in
   * dev either. Keyed by `${userId}:${sessionUuid}`. */
  private finalizedSessions = new Map<string, string>();

  async getActiveSession(userId: string): Promise<GameSession | null> {
    return this.sessions.get(userId) ?? null;
  }

  async createSession(userId: string, seed: string, difficulty: Difficulty, crimeTimestamp: number): Promise<GameSession> {
    const session = freshSession(userId, seed, difficulty, crimeTimestamp);
    this.sessions.set(userId, session);
    return session;
  }

  async saveSession(userId: string, session: GameSession): Promise<void> {
    this.sessions.set(userId, session);
  }

  async deleteActiveSession(userId: string): Promise<void> {
    this.sessions.delete(userId);
  }

  async getProfile(userId: string): Promise<PlayerProfile> {
    let profile = this.profiles.get(userId);
    if (!profile) {
      profile = freshProfile(userId);
      this.profiles.set(userId, profile);
    }
    return profile;
  }

  async updateSettings(userId: string, patch: Partial<PlayerSettings>): Promise<PlayerProfile> {
    const profile = await this.getProfile(userId);
    profile.settings = { ...profile.settings, ...patch };
    return profile;
  }

  async advanceTime(userId: string, sessionUuid: string, minutes: AllowedTimeDelta): Promise<number> {
    if (!ALLOWED_TIME_DELTAS.includes(minutes)) throw new Error("caseline: invalid time delta");
    const session = this.sessions.get(userId);
    if (!session || session.sessionUuid !== sessionUuid) throw new Error("caseline: no matching active session");
    session.currentTime += minutes;
    return session.currentTime;
  }

  async finalizeCase(userId: string, sessionUuid: string, input: FinalizeCaseInput): Promise<FinalizeCaseResult> {
    const key = `${userId}:${sessionUuid}`;
    const existingId = this.finalizedSessions.get(key);
    if (existingId) return { historyId: existingId, alreadyFinalized: true, profile: await this.getProfile(userId) };

    const session = this.sessions.get(userId);
    if (session && session.sessionUuid === sessionUuid) session.accusation = input.accusation;

    const profile = await this.getProfile(userId);
    const { newXp, newRank } = applyCaseToCareer(profile.xp, input.score);
    profile.xp = newXp;
    profile.rank = newRank;
    profile.accusationsTotal += 1;
    if (input.culpritCorrect) profile.casesSolved += 1;
    else profile.casesFailed += 1;

    const id = randomId("case");
    const list = this.history.get(userId) ?? [];
    list.unshift({ seed: input.seed, difficulty: input.difficulty, accusation: input.accusation, score: input.score, id, completedAt: Date.now() });
    this.history.set(userId, list);
    this.finalizedSessions.set(key, id);

    return { historyId: id, alreadyFinalized: false, profile };
  }

  async listCaseHistory(userId: string): Promise<CaseHistoryEntry[]> {
    return this.history.get(userId) ?? [];
  }

  async getCaseHistoryEntry(userId: string, entryId: string): Promise<CaseHistoryEntry | null> {
    return (this.history.get(userId) ?? []).find((e) => e.id === entryId) ?? null;
  }
}
