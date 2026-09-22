import type { Difficulty } from "@/lib/game-engine/types/case";
import type { Accusation, EvidencePlayerStatus, GameSession, HintHistoryEntry, HintState, InvestigationEvent, LabJob, MandateRecord, SurveillanceRecord } from "../types";
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

/** Security S2 EXPAND-2 — every fixed, server-computed small time cost an
 * action pays, distinct from the player-facing TopBar deltas above:
 * `askQuestionAction`/`confrontAction`/`searchPhoneAction` (5),
 * `searchVehicleAction` (3), `searchCriminalRecordAction` (4),
 * `executeSearchWarrantAction` (20). Matches
 * `caseline_advance_time_internal`'s SQL allow-list exactly. */
export const ALLOWED_INTERNAL_TIME_COSTS = [3, 4, 5, 20] as const;
export type InternalTimeCost = (typeof ALLOWED_INTERNAL_TIME_COSTS)[number];

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

/** Security S2 EXPAND-2 — the authoritative slice of session state each
 * trusted mutation below returns after persisting. Callers overwrite the
 * corresponding fields on their local `GameSession` with these values
 * rather than trusting whatever the local pre-persistence computation
 * produced, exactly like APP-1's `advanceTimeAction` already does for
 * `currentTime` — this is what makes the RPC's result authoritative rather
 * than merely advisory. */
export interface AdvanceTimeResult {
  currentTimeMinutes: number;
  evidenceStatus: Record<string, EvidencePlayerStatus>;
  events: InvestigationEvent[];
}

export interface EvidenceMutationResult {
  evidenceStatus: Record<string, EvidencePlayerStatus>;
  events: InvestigationEvent[];
}

export interface LabSubmissionResult {
  labQueue: LabJob[];
  evidenceStatus: Record<string, EvidencePlayerStatus>;
  events: InvestigationEvent[];
}

export interface MandateMutationResult {
  mandates: Record<string, MandateRecord>;
  events: InvestigationEvent[];
}

export interface SurveillanceMutationResult {
  surveillance: Record<string, SurveillanceRecord>;
  events: InvestigationEvent[];
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
   * must be one of `ALLOWED_TIME_DELTAS`. Also completes any due lab jobs
   * and resolves any due events atomically alongside the clock (EXPAND-2 —
   * see `0009_s2_expand2_trusted_mutations.sql`'s extended
   * `caseline_advance_time`), so `evidence_status`/`investigation_events`
   * are never separately forgeable relative to the time that unlocked
   * them. `MemoryStore` enforces the same allow-list and completion logic
   * for dev/test parity even though it has no real security boundary to
   * protect. */
  advanceTime(userId: string, sessionUuid: string, minutes: AllowedTimeDelta): Promise<AdvanceTimeResult>;

  /** Security S2 EXPAND-2 — the small, fixed, server-computed time costs
   * baked into other actions (interrogation/confrontation/phone lookup = 5,
   * vehicle lookup = 3, criminal record lookup = 4, executing a granted
   * search warrant = 20) — never a player-chosen value, so this is a
   * separate, narrower allow-list from `advanceTime`'s TopBar deltas, not a
   * widening of it. Same completion semantics (lab/event resolution)
   * folded in atomically. */
  advanceTimeInternal(userId: string, sessionUuid: string, minutes: InternalTimeCost): Promise<AdvanceTimeResult>;

  /** Security S2 — one atomic, idempotent case resolution: persists the
   * accusation, archives exactly one `case_history` row, and updates
   * profile progression, or (if `sessionUuid` was already finalized)
   * changes nothing and reports `alreadyFinalized: true`. Replaces the
   * old two-step `completeCase` (separate history-insert + profile-update,
   * with no protection against a double-submit racing both). */
  finalizeCase(userId: string, sessionUuid: string, input: FinalizeCaseInput): Promise<FinalizeCaseResult>;

  listCaseHistory(userId: string): Promise<CaseHistoryEntry[]>;
  getCaseHistoryEntry(userId: string, entryId: string): Promise<CaseHistoryEntry | null>;

  // -----------------------------------------------------------------
  // Security S2 EXPAND-2 — trusted mutations for every remaining
  // authoritative column. Every method takes the semantic/already-computed
  // result the caller derived from `CaseTruth` (never raw player input),
  // persists it narrowly, and returns the authoritative post-write value —
  // callers must overwrite their local session fields with the returned
  // value, never assume their local pre-call computation is what actually
  // got stored (a concurrent/retried call may have already claimed it).
  // -----------------------------------------------------------------

  /** Marks one evidence id `"collected"`, only if it is currently
   * `"discovered"` — pure ownership/DB-state check, no `CaseTruth` needed.
   * No-op (not an error) otherwise, so a double-click is harmless. */
  collectEvidence(userId: string, sessionUuid: string, evidenceId: string): Promise<EvidenceMutationResult>;

  /** Persists evidence ids already filtered against `CaseTruth` by the
   * caller as newly `"discovered"`, plus an optional paired
   * `InvestigationEvent` (e.g. a witness callback becoming eligible).
   * Monotonic: never downgrades an id already past `"discovered"`. */
  revealEvidence(userId: string, sessionUuid: string, evidenceIds: string[], event: InvestigationEvent | null): Promise<EvidenceMutationResult>;

  /** Persists a lab submission whose `analysisType`/`readyAt` were derived
   * from `CaseTruth` by the caller, plus the paired `lab_result` event.
   * No-op if the evidence is already `"sent_to_lab"`/`"analyzed"`. */
  submitToLab(userId: string, sessionUuid: string, job: LabJob, event: InvestigationEvent | null): Promise<LabSubmissionResult>;

  /** Persists a mandate decision (`granted`/`reason`) already computed by
   * `evaluateMandate`, plus the paired warrant-decision event. Idempotent
   * on `record.key` — a mandate is decided once, at request time, never
   * re-decided by a retry. */
  requestMandate(userId: string, sessionUuid: string, record: MandateRecord, event: InvestigationEvent | null): Promise<MandateMutationResult>;

  /** Persists a surveillance record (including its already-computed
   * `observations`) produced by `startSurveillance`, plus the paired
   * `surveillance_result` event. Idempotent on the record's
   * `personId:startedAt` key. */
  startSurveillance(userId: string, sessionUuid: string, key: string, record: SurveillanceRecord, event: InvestigationEvent | null): Promise<SurveillanceMutationResult>;

  /** Persists one hint escalation already computed by `getNextHint`/
   * `escalateHint`. No-op if `entry.level` is at or below the
   * already-recorded progress for `entry.hintId` — a player cannot lower
   * or replay away the scoring penalty `computeHintPenalty` derives from
   * this state at accusation time. */
  recordHint(userId: string, sessionUuid: string, entry: HintHistoryEntry): Promise<HintState>;

  /** The only player-triggered mutation on `investigation_events` that
   * needs no `CaseTruth`: flips one event `"ready"` → `"seen"`, and
   * nothing else — a forged/stale id, or one still `"scheduled"`, is a
   * no-op. */
  markEventSeen(userId: string, sessionUuid: string, eventId: string): Promise<InvestigationEvent[]>;
}
