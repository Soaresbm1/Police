import type { GameSession } from "./types";
import { EVENT_DELAY_MINUTES, findEvent, scheduleEvent } from "./events";
import type { LocationId } from "@/lib/game-engine/types/location";

export type CctvRequestStatus = "not_requested" | "pending" | "ready";

export interface CctvRequestOutcome {
  status: CctvRequestStatus;
}

/**
 * The one safe projection of a CCTV request's player-facing state.
 * Unlike a mandate, there is no separate "decision" stored ahead of
 * time here — the footage itself simply isn't revealed
 * (`discovery.checkCameraFootage` is never called) until this reports
 * `"ready"`, so there is no raw field this could accidentally leak by
 * being read directly; the hardening is structural (deferred reveal),
 * not a hidden boolean to guard.
 */
export function describeCctvRequest(session: GameSession, locationId: LocationId): CctvRequestOutcome {
  const event = findEvent(session, "cctv_footage", { kind: "location", id: locationId });
  if (!event) return { status: "not_requested" };
  return { status: event.status === "scheduled" ? "pending" : "ready" };
}

/**
 * The player-facing "requisition this location's footage" entry point.
 * Idempotent — re-requesting the same location never resets the delay
 * or duplicates the event (`scheduleEvent` itself refuses to). The
 * notification payload never names what the footage shows, or even
 * that anything relevant was found — only that data has arrived. Always
 * returns `"pending"` or `"ready"` — never `"not_requested"`, since the
 * event now unconditionally exists by the time this returns.
 */
export function requestCctvFootage(session: GameSession, locationId: LocationId): { status: "pending" | "ready" } {
  const event = scheduleEvent(session, "cctv_footage", { kind: "location", id: locationId }, EVENT_DELAY_MINUTES.cctv_footage, {
    title: "VIDÉOSURVEILLANCE — Données disponibles",
    detail: "Bande transmise par l'exploitant du site.",
  });
  return { status: event.status === "scheduled" ? "pending" : "ready" };
}
