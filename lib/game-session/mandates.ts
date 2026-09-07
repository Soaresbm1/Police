import type { CaseTruth } from "@/lib/game-engine/types/case";
import type { PersonId } from "@/lib/game-engine/types/person";
import type { GameSession, MandateRecord } from "./types";

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
