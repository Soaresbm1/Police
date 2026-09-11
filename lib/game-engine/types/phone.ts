import type { PersonId } from "./person";
import type { GameMinutes } from "./time";

/**
 * Victim-phone digital-evidence layer (Motive & Digital Evidence, Phase 1).
 * Entirely immutable, pre-generated CaseTruth content — never created on
 * open/select/interrogate/accuse (see `victim-phone.ts`'s module doc
 * comment). Deliberately its own top-level `CaseTruth` field (like
 * `postCrimeMovements`), NOT stored as `Evidence[]` items — this is what
 * keeps it structurally invisible to `computeSolvability` (which only ever
 * iterates `CaseTruth.evidence`) unless a future phase intentionally wires
 * it in.
 *
 * A "contact" is one phone number the victim exchanged messages/calls
 * with — `personId` is populated only when that number legitimately
 * belongs to a generated `Person`; a handful of contacts are deliberately
 * left unmapped ("unknown number") noise.
 */
export interface PhoneContact {
  id: string;
  /** Null for a deliberately-unmapped "unknown number" contact. */
  personId: PersonId | null;
  phoneNumber: string;
}

export type PhoneMessageDirection = "from_victim" | "to_victim";

export interface PhoneMessage {
  id: string;
  timestamp: GameMinutes;
  direction: PhoneMessageDirection;
  content: string;
}

export interface PhoneConversation {
  id: string;
  contactId: string;
  /** Chronological, oldest first. */
  messages: PhoneMessage[];
}

export type PhoneCallDirection = "incoming" | "outgoing";

export interface PhoneCall {
  id: string;
  contactId: string;
  timestamp: GameMinutes;
  direction: PhoneCallDirection;
  answered: boolean;
  /** Null when `answered` is false. */
  durationSeconds: number | null;
}

export interface VictimPhoneData {
  ownerPersonId: PersonId;
  contacts: PhoneContact[];
  conversations: PhoneConversation[];
  /** Chronological, oldest first. */
  calls: PhoneCall[];
}
