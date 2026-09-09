import type { GameMinutes } from "@/lib/game-engine/types/time";
import type { GameSession, InvestigationEvent, InvestigationEventSource, InvestigationEventStatus, InvestigationEventType } from "./types";

/**
 * Deterministic delays for this milestone's scheduled events, in game
 * minutes — never real time, never random ("do not make delays random
 * merely for variety"). `lab_result` is intentionally absent: it reuses
 * `LabJob`'s own `readyAt` (see `discovery.ts#sendToLab`), which already
 * varies by analysis type via `LAB_ANALYSIS_DURATION_MINUTES`.
 *
 * Chosen against this game's existing time economy (`+30MIN/+1H/+4H`,
 * lab durations 20-120 min): long enough that the player must genuinely
 * do something else and come back, short enough to resolve within one or
 * two clock-advance clicks.
 * - `bank_warrant`/`search_warrant` (60/90 min): an administrative
 *   decision — a judge/prosecutor reviewing a request, not a lab test.
 * - `bank_records` (90 min): the bank actually retrieving and
 *   transmitting statements, once authorized — deliberately a second,
 *   separate wait from the warrant decision itself.
 * - `cctv_footage` (45 min, within the brief's 30-60 min range): a site
 *   operator/archive pulling an already-recorded tape — no judicial step
 *   involved, shorter than a warrant decision.
 * - `phone_records` (90 min, within the brief's 60-120 min range): the
 *   telecom operator producing a detailed log, reusing the same
 *   already-vetted duration as `bank_records` for a comparable
 *   "external party retrieves records" wait.
 */
export const EVENT_DELAY_MINUTES = {
  bank_warrant: 60,
  bank_records: 90,
  search_warrant: 90,
  cctv_footage: 45,
  phone_records: 90,
} as const;

/** Deterministic id from `type`+`source` only — no random UUIDs. The same
 * logical event (e.g. "the bank warrant for person X") always resolves to
 * the same id, which is also what makes duplicate-scheduling prevention
 * trivial: `scheduleEvent` below just checks whether this id already
 * exists. */
export function makeEventId(type: InvestigationEventType, source: InvestigationEventSource): string {
  return `${type}:${source.kind}:${source.id}`;
}

export function findEvent(session: GameSession, type: InvestigationEventType, source: InvestigationEventSource): InvestigationEvent | undefined {
  const id = makeEventId(type, source);
  return session.events.find((e) => e.id === id);
}

/**
 * Schedules a new event, or returns the existing one unchanged if this
 * exact logical event (same `type`+`source`) was already scheduled —
 * requesting the same thing twice (a double click, a revisited screen)
 * can never reset the delay or create a duplicate.
 *
 * `payload` must already be player-safe, fully-rendered text (see the
 * doc comment on `InvestigationEvent` in `types.ts`) — this function does
 * not sanitize it.
 */
export function scheduleEvent(
  session: GameSession,
  type: InvestigationEventType,
  source: InvestigationEventSource,
  delayMinutes: number,
  payload: { title: string; detail: string },
): InvestigationEvent {
  const id = makeEventId(type, source);
  const existing = session.events.find((e) => e.id === id);
  if (existing) return existing;

  const event: InvestigationEvent = {
    id,
    type,
    source,
    createdAt: session.currentTime,
    scheduledAt: session.currentTime + delayMinutes,
    status: "scheduled",
    payload,
  };
  session.events.push(event);
  return event;
}

/** Stable order every list/UI should present events in: earliest
 * scheduled first, deterministic id tie-break so two events scheduled
 * for the exact same minute never reorder between renders. */
export function sortedEvents(session: GameSession): InvestigationEvent[] {
  return [...session.events].sort((a, b) => a.scheduledAt - b.scheduledAt || a.id.localeCompare(b.id));
}

/**
 * Flips every `scheduled` event whose time has come to `ready`, in the
 * stable order above, and returns just the ones that changed this call.
 * Naturally idempotent: a second call at the same `currentTime` finds
 * nothing left in `scheduled` state at-or-before now, so it returns `[]`
 * and changes nothing — there is no separate "already fired" flag to
 * maintain, the status transition itself is the guard against firing an
 * event twice.
 */
export function resolveEvents(session: GameSession): InvestigationEvent[] {
  const due = sortedEvents(session).filter((e) => e.status === "scheduled" && session.currentTime >= e.scheduledAt);
  for (const event of due) {
    const target = session.events.find((e) => e.id === event.id);
    if (target) target.status = "ready";
  }
  return due;
}

/** Only a `ready` event can become `seen` — a `scheduled` event is never
 * player-visible in the first place, so there is nothing to mark. */
export function markEventSeen(session: GameSession, eventId: string): void {
  const event = session.events.find((e) => e.id === eventId);
  if (event && event.status === "ready") event.status = "seen";
}

/** `ready` (not yet `seen`) events — what the TopBar badge counts and
 * what triggers the notification sound. Deliberately excludes
 * `scheduled` events: the player must never learn something is coming
 * before it actually arrives. */
export function readyUnseenCount(session: GameSession): number {
  return session.events.filter((e) => e.status === "ready").length;
}

/** `ready`/`seen` events only, in display order — the investigation
 * inbox's data source. `scheduled` events are never surfaced. */
export function visibleEvents(session: GameSession): InvestigationEvent[] {
  return sortedEvents(session).filter((e) => e.status !== "scheduled");
}

export type { InvestigationEvent, InvestigationEventSource, InvestigationEventStatus, InvestigationEventType, GameMinutes };
