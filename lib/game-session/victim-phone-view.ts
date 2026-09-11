import type { CaseTruth } from "@/lib/game-engine/types/case";
import type { GameSession } from "./types";
import { formatGameTime } from "@/lib/game-engine/types/time";
import { evidenceStatusOf } from "./player-view";

/**
 * Player-safe projection of `CaseTruth.victimPhone` (Motive & Digital
 * Evidence Phase 1). This is the ONLY path the browser ever sees phone
 * content through — every field here is either already-safe primitive
 * data or a deliberately-resolved display value. It never carries
 * `personId` directly (only `isKnownPerson` + the resolved `displayName`),
 * never a template/motive-category tag, and never any hidden truth field
 * (`culpritId`, `actualMotive`, `crimeRelevance`, `isMotiveClue`,
 * `templateCategory`, ... — none of these exist anywhere in this module).
 *
 * Gated exactly like a lab report (`lib/game-session/lab-report.ts`): the
 * underlying `victim_phone` evidence item must be `"analyzed"` — i.e. the
 * device was found AND sent through the (existing, reused) digital-
 * forensics lab workflow — before any conversation/call content is
 * returned. Before that, only `status` is meaningful.
 */

export type VictimPhoneStatus = "not_found" | "found" | "extracting" | "ready";

export interface PhoneContactView {
  id: string;
  displayName: string;
  phoneNumber: string;
  isKnownPerson: boolean;
}

export interface PhoneMessageView {
  id: string;
  timestamp: number;
  timeLabel: string;
  direction: "from_victim" | "to_victim";
  content: string;
}

export interface PhoneConversationView {
  id: string;
  contact: PhoneContactView;
  messages: PhoneMessageView[];
  lastActivityAt: number;
  lastMessagePreview: string;
}

export interface PhoneCallView {
  id: string;
  contact: PhoneContactView;
  timestamp: number;
  timeLabel: string;
  direction: "incoming" | "outgoing";
  answered: boolean;
  durationLabel: string | null;
}

export interface VictimPhoneView {
  status: VictimPhoneStatus;
  evidenceId: string | null;
  conversations: PhoneConversationView[];
  calls: PhoneCallView[];
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m} min ${s.toString().padStart(2, "0")}` : `${s} s`;
}

/** Finds the one `victim_phone` evidence item this case has — always
 * exactly one, generated unconditionally per case (see `victim-phone.ts`).
 * Returns `undefined` only defensively (a session persisted before this
 * feature shipped would regenerate `truth` fresh on next load and get one
 * automatically — see `withSession`). */
function findPhoneEvidence(truth: CaseTruth) {
  return truth.evidence.find((e) => e.type === "victim_phone");
}

export function getVictimPhoneStatus(truth: CaseTruth, session: GameSession): VictimPhoneStatus {
  const evidence = findPhoneEvidence(truth);
  if (!evidence) return "not_found";
  const playerStatus = evidenceStatusOf(session, evidence.id);
  switch (playerStatus) {
    case "undiscovered":
      return "not_found";
    case "discovered":
    case "collected":
      return "found";
    case "sent_to_lab":
      return "extracting";
    case "analyzed":
      return "ready";
  }
}

export function getVictimPhoneView(truth: CaseTruth, session: GameSession): VictimPhoneView {
  const evidence = findPhoneEvidence(truth);
  const status = getVictimPhoneStatus(truth, session);
  if (status !== "ready" || !evidence) {
    return { status, evidenceId: evidence?.id ?? null, conversations: [], calls: [] };
  }

  const phone = truth.victimPhone;
  const peopleById = new Map(truth.people.map((p) => [p.id, p]));
  const contactViewById = new Map<string, PhoneContactView>();
  for (const contact of phone.contacts) {
    const person = contact.personId ? peopleById.get(contact.personId) : undefined;
    contactViewById.set(contact.id, {
      id: contact.id,
      displayName: person ? `${person.firstName} ${person.lastName}` : "Numéro inconnu",
      phoneNumber: contact.phoneNumber,
      isKnownPerson: Boolean(person),
    });
  }

  const conversations: PhoneConversationView[] = phone.conversations
    .filter((conv) => conv.messages.length > 0)
    .map((conv) => {
      const contact = contactViewById.get(conv.contactId)!;
      const messages: PhoneMessageView[] = conv.messages.map((m) => ({
        id: m.id,
        timestamp: m.timestamp,
        timeLabel: formatGameTime(m.timestamp),
        direction: m.direction,
        content: m.content,
      }));
      const last = messages[messages.length - 1];
      return { id: conv.id, contact, messages, lastActivityAt: last.timestamp, lastMessagePreview: last.content };
    })
    // Latest activity first — natural phone behavior (req. 22). Never
    // guilt-derived: purely a function of each conversation's own message
    // timestamps, which are themselves rolled independently per contact
    // (see `victim-phone.ts#buildConversation`) — never keyed off which
    // contact happens to be the culprit.
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt);

  const calls: PhoneCallView[] = phone.calls
    .map((call) => ({
      id: call.id,
      contact: contactViewById.get(call.contactId)!,
      timestamp: call.timestamp,
      timeLabel: formatGameTime(call.timestamp),
      direction: call.direction,
      answered: call.answered,
      durationLabel: call.answered && call.durationSeconds !== null ? formatDuration(call.durationSeconds) : null,
    }))
    .sort((a, b) => b.timestamp - a.timestamp);

  return { status, evidenceId: evidence.id, conversations, calls };
}
