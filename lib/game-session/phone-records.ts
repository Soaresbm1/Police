import type { GameSession } from "./types";
import { EVENT_DELAY_MINUTES, findEvent, scheduleEvent } from "./events";
import type { PersonId } from "@/lib/game-engine/types/person";

export type PhoneRecordsStatus = "not_requested" | "pending" | "ready";

export interface PhoneRecordsOutcome {
  status: PhoneRecordsStatus;
}

/**
 * The one safe projection of a phone-records request's player-facing
 * state. Identifying WHO owns a number stays a separate, instant,
 * harmless lookup (see `app-actions.ts#searchPhoneAction`) — this only
 * gates the detailed digital records (calls, SMS, geolocation, browsing
 * history...) for that person. Like `cctv.ts`, there is no separate
 * hidden decision field here: the records simply aren't revealed
 * (`discovery.checkDigitalRecords` is never called) until this reports
 * `"ready"`.
 */
export function describePhoneRequest(session: GameSession, personId: PersonId): PhoneRecordsOutcome {
  const event = findEvent(session, "phone_records", { kind: "person", id: personId });
  if (!event) return { status: "not_requested" };
  return { status: event.status === "scheduled" ? "pending" : "ready" };
}

/**
 * The player-facing "request this person's phone records" entry point.
 * Idempotent, same duplicate-prevention as every other scheduled
 * request. The notification payload never names a contact, location, or
 * conclusion — only that a log has arrived. Always returns `"pending"`
 * or `"ready"` — never `"not_requested"`, since the event now
 * unconditionally exists by the time this returns.
 */
export function requestPhoneRecords(session: GameSession, personId: PersonId): { status: "pending" | "ready" } {
  const event = scheduleEvent(session, "phone_records", { kind: "person", id: personId }, EVENT_DELAY_MINUTES.phone_records, {
    title: "TÉLÉPHONIE — Relevés disponibles",
    detail: "Relevés transmis par l'opérateur.",
  });
  return { status: event.status === "scheduled" ? "pending" : "ready" };
}
