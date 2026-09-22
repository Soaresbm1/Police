import type { Difficulty } from "@/lib/game-engine/types/case";
import type { EvidencePlayerStatus, GameSession, HintHistoryEntry, HintState, InvestigationEvent, LabJob, MandateRecord, SurveillanceRecord } from "../types";
import { applyCaseToCareer } from "../career";
import {
  ALLOWED_INTERNAL_TIME_COSTS,
  ALLOWED_TIME_DELTAS,
  type AdvanceTimeResult,
  type AllowedTimeDelta,
  type CaseHistoryEntry,
  type EvidenceMutationResult,
  type FinalizeCaseInput,
  type FinalizeCaseResult,
  type InternalTimeCost,
  type LabSubmissionResult,
  type MandateMutationResult,
  type PlayerProfile,
  type PlayerSettings,
  type SessionStore,
  type SurveillanceMutationResult,
} from "./types";

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

  private applyTimeEffects(session: GameSession): AdvanceTimeResult {
    for (const job of session.labQueue) {
      if (session.currentTime >= job.readyAt && session.evidenceStatus[job.evidenceId] === "sent_to_lab") {
        session.evidenceStatus[job.evidenceId] = "analyzed";
      }
    }
    for (const event of session.events) {
      if (event.status === "scheduled" && session.currentTime >= event.scheduledAt) event.status = "ready";
    }
    return { currentTimeMinutes: session.currentTime, evidenceStatus: session.evidenceStatus, events: session.events };
  }

  async advanceTime(userId: string, sessionUuid: string, minutes: AllowedTimeDelta): Promise<AdvanceTimeResult> {
    if (!ALLOWED_TIME_DELTAS.includes(minutes)) throw new Error("caseline: invalid time delta");
    const session = this.requireSession(userId, sessionUuid);
    session.currentTime += minutes;
    return this.applyTimeEffects(session);
  }

  async advanceTimeInternal(userId: string, sessionUuid: string, minutes: InternalTimeCost): Promise<AdvanceTimeResult> {
    if (!ALLOWED_INTERNAL_TIME_COSTS.includes(minutes)) throw new Error("caseline: invalid internal time cost");
    const session = this.requireSession(userId, sessionUuid);
    session.currentTime += minutes;
    return this.applyTimeEffects(session);
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

  // -----------------------------------------------------------------
  // Security S2 EXPAND-2 parity — mirrors the exact idempotency/monotonic
  // rules `supabase/migrations/0009_s2_expand2_trusted_mutations.sql`
  // enforces in Postgres, so dev/test behavior matches Preview/Production.
  // -----------------------------------------------------------------

  private requireSession(userId: string, sessionUuid: string): GameSession {
    const session = this.sessions.get(userId);
    if (!session || session.sessionUuid !== sessionUuid) throw new Error("caseline: no matching active session");
    return session;
  }

  private appendEventIfNew(session: GameSession, event: InvestigationEvent | null): void {
    if (!event) return;
    if (session.events.some((e) => e.id === event.id)) return;
    session.events.push(event);
  }

  async collectEvidence(userId: string, sessionUuid: string, evidenceId: string): Promise<EvidenceMutationResult> {
    const session = this.requireSession(userId, sessionUuid);
    if (session.evidenceStatus[evidenceId] === "discovered") {
      session.evidenceStatus[evidenceId] = "collected";
    }
    return { evidenceStatus: session.evidenceStatus, events: session.events };
  }

  async revealEvidence(userId: string, sessionUuid: string, evidenceIds: string[], event: InvestigationEvent | null): Promise<EvidenceMutationResult> {
    const session = this.requireSession(userId, sessionUuid);
    for (const id of evidenceIds) {
      if (!(session.evidenceStatus as Record<string, EvidencePlayerStatus>)[id]) {
        session.evidenceStatus[id] = "discovered";
      }
    }
    this.appendEventIfNew(session, event);
    return { evidenceStatus: session.evidenceStatus, events: session.events };
  }

  async submitToLab(userId: string, sessionUuid: string, job: LabJob, event: InvestigationEvent | null): Promise<LabSubmissionResult> {
    const session = this.requireSession(userId, sessionUuid);
    const current = session.evidenceStatus[job.evidenceId];
    if (current === "sent_to_lab" || current === "analyzed") {
      return { labQueue: session.labQueue, evidenceStatus: session.evidenceStatus, events: session.events };
    }
    if (job.readyAt < session.currentTime) throw new Error("caseline: implausible lab ready time");
    session.evidenceStatus[job.evidenceId] = "sent_to_lab";
    session.labQueue.push(job);
    this.appendEventIfNew(session, event);
    return { labQueue: session.labQueue, evidenceStatus: session.evidenceStatus, events: session.events };
  }

  async requestMandate(userId: string, sessionUuid: string, record: MandateRecord, event: InvestigationEvent | null): Promise<MandateMutationResult> {
    const session = this.requireSession(userId, sessionUuid);
    if (!session.mandates[record.key]) {
      session.mandates[record.key] = record;
    }
    this.appendEventIfNew(session, event);
    return { mandates: session.mandates, events: session.events };
  }

  async startSurveillance(userId: string, sessionUuid: string, key: string, record: SurveillanceRecord, event: InvestigationEvent | null): Promise<SurveillanceMutationResult> {
    const session = this.requireSession(userId, sessionUuid);
    if (!session.surveillance[key]) {
      session.surveillance[key] = record;
    }
    this.appendEventIfNew(session, event);
    return { surveillance: session.surveillance, events: session.events };
  }

  async recordHint(userId: string, sessionUuid: string, entry: HintHistoryEntry): Promise<HintState> {
    const session = this.requireSession(userId, sessionUuid);
    const existing = session.hintState.progress[entry.hintId] ?? 0;
    if (entry.level <= existing) return session.hintState;
    session.hintState.progress[entry.hintId] = entry.level;
    session.hintState.history.push(entry);
    session.hintState.totalHintsUsed += 1;
    return session.hintState;
  }

  async markEventSeen(userId: string, sessionUuid: string, eventId: string): Promise<InvestigationEvent[]> {
    const session = this.requireSession(userId, sessionUuid);
    const event = session.events.find((e) => e.id === eventId);
    if (event && event.status === "ready") event.status = "seen";
    return session.events;
  }
}
