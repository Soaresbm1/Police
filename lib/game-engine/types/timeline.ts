import type { PersonId } from "./person";
import type { LocationId } from "./location";
import type { GameMinutes } from "./time";

export type TimelineActionType =
  | "sleep"
  | "wake_up"
  | "travel"
  | "arrive"
  | "leave"
  | "work"
  | "meet"
  | "phone_call"
  | "send_message"
  | "purchase"
  | "withdraw_cash"
  | "argument"
  | "attack"
  | "conceal_evidence"
  | "destroy_evidence"
  | "clean"
  | "flee"
  | "observe"
  | "stage_scene"
  | "dispose_object"
  | "avoid_location"
  | "other";

/**
 * Tags describing what *kind* of trace an event could plausibly leave. The
 * evidence engine (Phase 2) reads these to derive concrete Evidence records —
 * the timeline never references evidence types directly, keeping the two
 * engines decoupled.
 */
export type EvidenceSourceTag =
  | "camera"
  | "phone_cell_tower"
  | "phone_wifi"
  | "badge_access"
  | "fingerprint"
  | "dna"
  | "blood"
  | "fiber"
  | "shoeprint"
  | "card_payment"
  | "cash_withdrawal"
  | "bank_transfer"
  | "call_record"
  | "sms_record"
  | "witness_sightline"
  | "vehicle_sighting"
  | "physical_object_moved";

export interface TimelineEvent {
  id: string;
  timestamp: GameMinutes;
  durationMinutes: number;
  actorId: PersonId;
  locationId: LocationId;
  action: TimelineActionType;
  /** Ground-truth factual description. Server-only; never shown verbatim to the player. */
  description: string;
  presentPersonIds: PersonId[];
  /** Other person this event is directed at/with, when relevant (a call recipient, a meeting partner). */
  counterpartyId: PersonId | null;
  involvedObject: string | null;
  observable: boolean;
  evidenceSourceTags: EvidenceSourceTag[];
  isCrimeEvent: boolean;
}

export class Timeline {
  readonly events: TimelineEvent[];

  constructor(events: TimelineEvent[]) {
    this.events = [...events].sort((a, b) => a.timestamp - b.timestamp);
  }

  forActor(personId: PersonId): TimelineEvent[] {
    return this.events.filter((e) => e.actorId === personId || e.presentPersonIds.includes(personId));
  }

  at(personId: PersonId, timestamp: GameMinutes): TimelineEvent | undefined {
    return this.events.find(
      (e) =>
        (e.actorId === personId || e.presentPersonIds.includes(personId)) &&
        timestamp >= e.timestamp &&
        timestamp < e.timestamp + Math.max(1, e.durationMinutes),
    );
  }

  between(start: GameMinutes, end: GameMinutes): TimelineEvent[] {
    return this.events.filter((e) => e.timestamp >= start && e.timestamp < end);
  }
}
