import type { CaseTruth } from "@/lib/game-engine/types/case";
import type { Evidence } from "@/lib/game-engine/types/evidence";
import type { PersonId } from "@/lib/game-engine/types/person";
import type { ConfrontationOpportunity, ConfrontationReactionKind, ConfrontationRelationKind } from "@/lib/game-engine/types/confrontation";
import { deriveConfrontationOpportunities } from "@/lib/game-engine/witness/confrontations";
import { RECORD_TYPE_LABEL } from "./labels";
import type { GameSession } from "./types";
import { findEvent, markEventSeen, resolveEvents, scheduleEvent } from "./events";
import { displayLocationName, evidenceStatusOf } from "./player-view";

/**
 * Player-facing wording MUST distinguish a real contradiction from mere
 * relevance — see the audit on `ConfrontationRelationKind`. "Confronter"
 * is only ever shown for `alibi_conflict` (an actually-proven
 * contradiction); `evidence_backed_followup` uses "Relancer" (press
 * further) instead, since same-event evidence only proves the topic is
 * documented, never that the person's belief is wrong.
 */
const RELATION_ACTION_LABEL: Record<ConfrontationRelationKind, string> = {
  alibi_conflict: "Confronter",
  evidence_backed_followup: "Relancer",
};

const RELATION_RESULT_LABEL: Record<ConfrontationRelationKind, string> = {
  alibi_conflict: "Confronté avec",
  evidence_backed_followup: "Relancé avec",
};

export interface ConfrontationOptionView {
  opportunityId: string;
  factId: string;
  evidenceId: string;
  evidenceLabel: string;
  relationKind: ConfrontationRelationKind;
  /** "Confronter" or "Relancer" — see `RELATION_ACTION_LABEL`. */
  actionLabel: string;
}

export interface PerformedConfrontationView {
  opportunityId: string;
  factId: string;
  evidenceId: string;
  evidenceLabel: string;
  relationKind: ConfrontationRelationKind;
  /** "Confronté avec" or "Relancé avec" — see `RELATION_RESULT_LABEL`. */
  resultLabel: string;
  reactionKind: ConfrontationReactionKind;
  reaction: string;
  performedAt: number;
}

/** A piece of evidence is confrontable once the player has actually
 * discovered it — and, for anything requiring lab work, only once that
 * analysis has actually completed. This is deliberately stricter than
 * the generic `evidenceStatusOf(...) !== "undiscovered"` check other
 * screens use: "discovered"/"collected" on a lab-gated item means it's
 * sitting in an evidence bag, not yet identified/confirmed — exactly the
 * `requiresLabAnalysis` cases where using it to confront someone before
 * `"analyzed"` would let raw generation data (who a fingerprint belongs
 * to) leak into gameplay before the fiction's own investigative process
 * would allow it. CCTV/phone/bank readiness needs no separate check here
 * — those evidence rows are structurally unreachable (`evidenceStatus`
 * stays `"undiscovered"`) until their own async request has already
 * resolved (see `cctv.ts`/`phone-records.ts`/`mandates.ts`). */
function isEvidenceConfrontable(evidence: Evidence, session: GameSession): boolean {
  const status = evidenceStatusOf(session, evidence.id);
  if (status === "undiscovered") return false;
  if (evidence.requiresLabAnalysis && status !== "analyzed") return false;
  return true;
}

function evidenceLabel(truth: CaseTruth, evidence: Evidence): string {
  const typeLabel = RECORD_TYPE_LABEL[evidence.type];
  const locationId = evidence.relatedLocationIds[0];
  const location = locationId ? truth.locations.find((l) => l.id === locationId) : undefined;
  return location ? `${typeLabel} — ${displayLocationName(location)}` : typeLabel;
}

function eligibleOpportunities(truth: CaseTruth, session: GameSession, personId: PersonId): ConfrontationOpportunity[] {
  const asked = new Set(session.interrogated[personId] ?? []);
  const evidenceById = new Map(truth.evidence.map((e) => [e.id, e]));
  return deriveConfrontationOpportunities(truth).filter((op) => {
    if (op.personId !== personId) return false;
    if (!asked.has(op.factId)) return false;
    const evidence = evidenceById.get(op.evidenceId);
    if (!evidence) return false;
    return isEvidenceConfrontable(evidence, session);
  });
}

function isPerformed(session: GameSession, opportunityId: string): boolean {
  return findEvent(session, "confrontation", { kind: "confrontation", id: opportunityId }) !== undefined;
}

/**
 * Confrontation/follow-up options currently offerable for a person —
 * already asked, evidence already confrontable, not yet performed. This
 * (never `deriveConfrontationOpportunities` directly) is the only thing
 * safe to render on the interrogation page: it deliberately omits
 * `reactionKind`/`reaction`, so the client never learns what will be
 * revealed before the player actually chooses to act.
 */
export function getConfrontationOptions(truth: CaseTruth, session: GameSession, personId: PersonId): ConfrontationOptionView[] {
  return eligibleOpportunities(truth, session, personId)
    .filter((op) => !isPerformed(session, op.id))
    .map((op) => {
      const evidence = truth.evidence.find((e) => e.id === op.evidenceId)!;
      return {
        opportunityId: op.id,
        factId: op.factId,
        evidenceId: op.evidenceId,
        evidenceLabel: evidenceLabel(truth, evidence),
        relationKind: op.relationKind,
        actionLabel: RELATION_ACTION_LABEL[op.relationKind],
      };
    });
}

/** Every confrontation/follow-up already performed for this person, for
 * the transcript — reaction content is re-derived from `CaseTruth` on
 * every read (never stored in session state), the same "regenerate,
 * don't persist secrets" discipline as Phase 3's callbacks. */
export function getPerformedConfrontations(truth: CaseTruth, session: GameSession, personId: PersonId): PerformedConfrontationView[] {
  const opportunitiesById = new Map(deriveConfrontationOpportunities(truth).map((op) => [op.id, op]));
  const performed = session.events.filter(
    (e) => e.type === "confrontation" && e.source.kind === "confrontation" && opportunitiesById.get(e.source.id)?.personId === personId,
  );
  return performed
    .map((event) => {
      const op = opportunitiesById.get(event.source.id)!;
      const evidence = truth.evidence.find((e) => e.id === op.evidenceId)!;
      return {
        opportunityId: op.id,
        factId: op.factId,
        evidenceId: op.evidenceId,
        evidenceLabel: evidenceLabel(truth, evidence),
        relationKind: op.relationKind,
        resultLabel: RELATION_RESULT_LABEL[op.relationKind],
        reactionKind: op.reactionKind,
        reaction: op.reaction,
        performedAt: event.createdAt,
      };
    })
    .sort((a, b) => a.performedAt - b.performedAt);
}

/**
 * Performs a confrontation/follow-up: validates the opportunity is
 * real, currently eligible (asked + evidence confrontable), and not
 * already performed, then records it — instantly, never as a
 * pending/delayed notification (see `types.ts`'s doc comment on
 * `InvestigationEventType`). Returns the predetermined reaction, or
 * `null` if the opportunity doesn't exist or isn't currently eligible (a
 * stale/tampered client request).
 *
 * If this exact action was already performed, returns its existing
 * reaction unchanged rather than erroring or re-recording it —
 * idempotent, matching every other Living Investigation System action.
 */
export function performConfrontation(
  truth: CaseTruth,
  session: GameSession,
  personId: PersonId,
  opportunityId: string,
): PerformedConfrontationView | null {
  const already = getPerformedConfrontations(truth, session, personId).find((c) => c.opportunityId === opportunityId);
  if (already) return already;

  const opportunity = eligibleOpportunities(truth, session, personId).find((op) => op.id === opportunityId);
  if (!opportunity) return null;

  const evidence = truth.evidence.find((e) => e.id === opportunity.evidenceId)!;
  const event = scheduleEvent(session, "confrontation", { kind: "confrontation", id: opportunity.id }, 0, {
    title: "Confrontation",
    detail: "Confrontation menée durant une audition.",
  });
  resolveEvents(session);
  markEventSeen(session, event.id);

  return {
    opportunityId: opportunity.id,
    factId: opportunity.factId,
    evidenceId: opportunity.evidenceId,
    evidenceLabel: evidenceLabel(truth, evidence),
    relationKind: opportunity.relationKind,
    resultLabel: RELATION_RESULT_LABEL[opportunity.relationKind],
    reactionKind: opportunity.reactionKind,
    reaction: opportunity.reaction,
    performedAt: event.createdAt,
  };
}
