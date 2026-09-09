import type { CaseTruth } from "@/lib/game-engine/types/case";
import type { PersonId } from "@/lib/game-engine/types/person";
import type { GameSession, MandateRecord } from "./types";
import { EVENT_DELAY_MINUTES, findEvent, scheduleEvent } from "./events";

export type MandateKind = "search" | "bank";

/**
 * A search or bank-records mandate requires the player to already have
 * *some* discovered, non-red-herring evidence connecting this person to the
 * case before a judge would grant it — mirrors the design brief's warrant
 * mechanic (§17) without a separate justification-text UI.
 */
export function mandateKey(kind: MandateKind, personId: PersonId): string {
  return `${kind}:${personId}`;
}

const MANDATE_LABEL: Record<MandateKind, string> = {
  search: "de perquisition",
  bank: "de consultation bancaire",
};

export function evaluateMandate(truth: CaseTruth, session: GameSession, kind: MandateKind, personId: PersonId): MandateRecord {
  const key = mandateKey(kind, personId);
  const existing = session.mandates[key];
  if (existing) return existing;

  const discoveredCount = truth.evidence.filter(
    (ev) =>
      !ev.isRedHerring &&
      ev.relatedPersonIds.includes(personId) &&
      session.evidenceStatus[ev.id] &&
      session.evidenceStatus[ev.id] !== "undiscovered",
  ).length;

  const granted = discoveredCount >= 1;
  const label = MANDATE_LABEL[kind];
  const record: MandateRecord = {
    key,
    granted,
    reason: granted
      ? `Mandat ${label} accordé : ${discoveredCount} élément(s) déjà réunis relient cette personne à l'affaire.`
      : `Mandat ${label} refusé : aucun élément tangible ne relie pour l'instant cette personne à l'affaire. Continuez l'enquête.`,
    requestedAt: session.currentTime,
  };
  session.mandates[key] = record;
  return record;
}

// ---------------------------------------------------------------------
// Deterministic delay layer (Living Investigation System, Phase 1) — the
// decision above is still computed and stored immediately (it only
// depends on evidence already discovered, a snapshot at request time),
// but it is never exposed to the player until its InvestigationEvent
// resolves to "ready". Granted and denied requests are scheduled through
// the exact same call with the exact same delay, so neither the timing
// nor the event's existence can leak the outcome (req. 6-7).
// ---------------------------------------------------------------------

export type MandateRequestStatus = "pending" | "granted" | "denied";

export interface MandateRequestOutcome {
  status: MandateRequestStatus;
  reason: string;
}

const WARRANT_EVENT_TYPE = { bank: "bank_warrant", search: "search_warrant" } as const;

const WARRANT_TITLE: Record<MandateKind, string> = {
  bank: "BANQUE — Décision disponible",
  search: "MANDATS — Décision disponible",
};

/**
 * The one safe projection of a mandate's player-facing state — every
 * caller outside this file (`app-actions.ts`, `player-view.ts`, the
 * banking/mandats apps) must go through this function rather than
 * reading `session.mandates[key].granted` itself. Returns `"pending"`
 * for as long as the decision event hasn't resolved, regardless of what
 * `MandateRecord.granted` already holds underneath (the real decision is
 * computed early — see `evaluateMandate` — but stays hidden until then).
 * Safe to call repeatedly (e.g. every time an app screen renders) — it
 * never creates, schedules, or mutates anything.
 */
export function describeMandateEvent(session: GameSession, kind: MandateKind, personId: PersonId): MandateRequestOutcome {
  const event = findEvent(session, WARRANT_EVENT_TYPE[kind], { kind: "mandate", id: mandateKey(kind, personId) });
  if (!event || event.status === "scheduled") {
    return { status: "pending", reason: "Décision en attente." };
  }
  const record = session.mandates[mandateKey(kind, personId)];
  if (!record) return { status: "pending", reason: "Décision en attente." }; // defensive — should not happen once the event exists
  return { status: record.granted ? "granted" : "denied", reason: record.reason };
}

/** The player-facing "request a warrant/authorization" entry point.
 * Idempotent: re-requesting the same (kind, personId) never resets the
 * delay or re-evaluates the decision (`evaluateMandate` itself is
 * idempotent, and `scheduleEvent` refuses to duplicate-schedule). */
export function requestMandateWithDelay(truth: CaseTruth, session: GameSession, kind: MandateKind, personId: PersonId): MandateRequestOutcome {
  evaluateMandate(truth, session, kind, personId);
  scheduleEvent(session, WARRANT_EVENT_TYPE[kind], { kind: "mandate", id: mandateKey(kind, personId) }, EVENT_DELAY_MINUTES[WARRANT_EVENT_TYPE[kind]], {
    title: WARRANT_TITLE[kind],
    detail: `Réponse à la demande ${MANDATE_LABEL[kind]} déposée.`,
  });
  return describeMandateEvent(session, kind, personId);
}

export type BankRecordsStatus = "no_mandate" | "pending" | "denied" | "pending_records" | "ready";

export interface BankRecordsOutcome {
  status: BankRecordsStatus;
  reason: string;
}

/** The player-facing "retrieve bank records" entry point — only
 * meaningful once the bank warrant is `granted`. Schedules the records'
 * own separate delay the first time it's called after grant (idempotent,
 * same duplicate-prevention as above), so simply revisiting/re-selecting
 * a person in the banking app is what "requests" the records, matching
 * the app's existing auto-search-on-select UX. */
export function evaluateBankRecordsRequest(session: GameSession, personId: PersonId): BankRecordsOutcome {
  const warrantEvent = findEvent(session, "bank_warrant", { kind: "mandate", id: mandateKey("bank", personId) });
  if (!warrantEvent) return { status: "no_mandate", reason: "Aucune réquisition déposée." };

  const warrant = describeMandateEvent(session, "bank", personId);
  if (warrant.status === "pending") return { status: "pending", reason: warrant.reason };
  if (warrant.status === "denied") return { status: "denied", reason: warrant.reason };

  const recordsEvent = scheduleEvent(session, "bank_records", { kind: "mandate", id: mandateKey("bank", personId) }, EVENT_DELAY_MINUTES.bank_records, {
    title: "BANQUE — Documents disponibles",
    detail: "Documents bancaires transmis par l'établissement.",
  });
  return { status: recordsEvent.status === "scheduled" ? "pending_records" : "ready", reason: warrant.reason };
}
