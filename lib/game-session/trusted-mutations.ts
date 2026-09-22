import { getStore } from "./persistence";
import { ALLOWED_INTERNAL_TIME_COSTS, type InternalTimeCost } from "./persistence/types";
import type { GameSession, HintHistoryEntry, InvestigationEvent, LabJob, MandateRecord, SurveillanceRecord } from "./types";
import { findEvent } from "./events";

/**
 * Security S2 EXPAND-2 — the "compute locally, then commit authoritatively"
 * glue between the existing pure game logic (`discovery.ts`/`mandates.ts`/
 * `surveillance.ts`/`hints.ts`/`events.ts`, all unchanged — they already
 * correctly derive results from `CaseTruth`) and the trusted RPCs in
 * `supabase/migrations/0009_s2_expand2_trusted_mutations.sql`.
 *
 * Every function here takes a `GameSession` that a pure function has
 * ALREADY mutated locally (so the in-process request sees an immediately
 * consistent result), then persists that same result through the matching
 * RPC and overwrites the local fields with whatever the RPC actually
 * returns — never assumes the local computation is what got stored. This
 * mirrors `advanceTimeAction`'s existing pattern (`session.currentTime =
 * await getStore().advanceTime(...)`) for every remaining authoritative
 * column, and is what lets `discovery.ts` et al. stay pure/synchronous
 * while `SupabaseSessionStore#saveSession` stops touching these columns
 * entirely (see `sessionToPlayerOwnedRow`).
 */

/** Commits evidence ids a pure discovery function already revealed
 * locally. A no-op when nothing was revealed, so idempotent/no-op discovery
 * calls (e.g. re-examining an already-examined crime scene) never make an
 * unnecessary round trip. */
export async function commitRevealedEvidence(userId: string, session: GameSession, revealedIds: string[], event: InvestigationEvent | null = null): Promise<void> {
  if (revealedIds.length === 0 && !event) return;
  const result = await getStore().revealEvidence(userId, session.sessionUuid, revealedIds, event);
  session.evidenceStatus = result.evidenceStatus;
  session.events = result.events;
}

/** Commits a "collected" transition already applied locally by
 * `discovery.collectEvidence`. */
export async function commitCollectedEvidence(userId: string, session: GameSession, evidenceId: string): Promise<void> {
  const result = await getStore().collectEvidence(userId, session.sessionUuid, evidenceId);
  session.evidenceStatus = result.evidenceStatus;
}

/** Commits a lab submission already computed by `discovery.sendToLab`
 * (which pushed the job onto `session.labQueue` and scheduled the paired
 * event locally). Reads both back off the session so the RPC persists
 * exactly what was just computed. No-op if `sendToLab` itself refused
 * (e.g. evidence not eligible) — callers only invoke this when it
 * succeeded. */
export async function commitLabSubmission(userId: string, session: GameSession, evidenceId: string): Promise<void> {
  const job = session.labQueue.find((j) => j.evidenceId === evidenceId);
  if (!job) return;
  const event = findEvent(session, "lab_result", { kind: "evidence", id: evidenceId }) ?? null;
  const result = await getStore().submitToLab(userId, session.sessionUuid, job as LabJob, event);
  session.labQueue = result.labQueue;
  session.evidenceStatus = result.evidenceStatus;
  session.events = result.events;
}

/** Commits a mandate decision already computed by `evaluateMandate` (via
 * `requestMandateWithDelay`) and its paired warrant-decision event. */
export async function commitMandateRequest(userId: string, session: GameSession, record: MandateRecord, event: InvestigationEvent | null): Promise<void> {
  const result = await getStore().requestMandate(userId, session.sessionUuid, record, event);
  session.mandates = result.mandates;
  session.events = result.events;
}

/** Commits a surveillance record already computed by `startSurveillance`
 * and its paired `surveillance_result` event. */
export async function commitSurveillance(userId: string, session: GameSession, key: string, record: SurveillanceRecord, event: InvestigationEvent | null): Promise<void> {
  const result = await getStore().startSurveillance(userId, session.sessionUuid, key, record, event);
  session.surveillance = result.surveillance;
  session.events = result.events;
}

/** Commits one hint escalation already applied locally by
 * `getNextHint`/`escalateHint` — reads the entry they just pushed onto
 * `session.hintState.history` (the last one) rather than needing those
 * functions to hand it back separately. No-op for the terminal
 * ("no hints left") case, which never touches `hintState` at all. */
export async function commitHintProgress(userId: string, session: GameSession, hintIdBefore: string): Promise<void> {
  const entry = session.hintState.history[session.hintState.history.length - 1];
  if (!entry || entry.hintId !== hintIdBefore) return; // terminal / nothing recorded
  const result = await getStore().recordHint(userId, session.sessionUuid, entry as HintHistoryEntry);
  session.hintState = result;
}

/** Commits a `"ready"` -> `"seen"` transition — replaces the old direct
 * `markEventSeen(session, eventId)` local mutation entirely. */
export async function commitEventSeen(userId: string, session: GameSession, eventId: string): Promise<void> {
  const events = await getStore().markEventSeen(userId, session.sessionUuid, eventId);
  session.events = events;
}

/** Pays a fixed, server-computed action-cost time delta (never a
 * player-chosen value) through `caseline_advance_time_internal`, then
 * applies the same lab/event completion side effects the old local
 * `discovery.advanceTime` used to compute unprotected. Replaces every
 * `discovery.advanceTime(session, <small constant>)` call site. */
export async function payInternalTime(userId: string, session: GameSession, minutes: InternalTimeCost): Promise<void> {
  if (!(ALLOWED_INTERNAL_TIME_COSTS as readonly number[]).includes(minutes)) return;
  const result = await getStore().advanceTimeInternal(userId, session.sessionUuid, minutes);
  session.currentTime = result.currentTimeMinutes;
  session.evidenceStatus = result.evidenceStatus;
  session.events = result.events;
}
