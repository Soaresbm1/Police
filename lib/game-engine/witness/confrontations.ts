import type { CaseTruth } from "../types/case";
import type { ConfrontationOpportunity, ConfrontationReactionKind, ConfrontationRelationKind } from "../types/confrontation";

interface Candidate {
  factId: string;
  testimonyLineId: string;
  personId: string;
  evidenceId: string;
  relationKind: ConfrontationRelationKind;
  reactionKind: ConfrontationReactionKind;
  reaction: string;
}

/**
 * Every confrontation/follow-up opportunity this case could ever produce
 * — a pure function of `truth`. Like Phase 3's witness callbacks, there
 * is no rarity roll: every structurally-provable relation is always an
 * opportunity, forever — whether the player ever discovers the matching
 * evidence (and therefore ever sees it) is a session question, handled
 * entirely by `lib/game-session/confrontations.ts`, never here.
 *
 * === Audit: what can actually be proven, per evidence path ===
 *
 * `Evidence.sourceEventId === KnowledgeFact.aboutEventId` proves ONLY
 * "this evidence and this fact concern the same TimelineEvent" — never
 * that the evidence's content conflicts with the fact's
 * `believedStatement`. `Evidence` is built straight from the event's own
 * ground-truth fields (`event.actorId`/`event.locationId`/
 * `event.timestamp`, see `evidence-generator.ts`) — it carries no
 * structured record of what any specific witness claimed, so there is
 * nothing to compare a belief against without parsing prose (forbidden).
 * Concretely: a witness who sincerely misremembers a car as red
 * (`corruptStatement` in `knowledge-graph.ts` swaps a colour word
 * embedded in free text) and a phone/camera/financial record from the
 * exact same event prove nothing about that car's colour at all — the
 * record's own fields (who/where/when) may happen to match the witness's
 * account perfectly while the one detail they got wrong stays entirely
 * outside what either side structurally encodes. Same-event matching is
 * therefore used ONLY for the honest, narrower claim it can actually
 * support: "there is documented police evidence about this exact
 * moment", which is legitimate grounds to press someone who was
 * `omission`/`vague` about it, never grounds to call it a contradiction.
 *
 * Two structural sources result from this audit:
 *
 * 1. `stance: "lie"` — the only way a `TestimonyLine` ever gets this
 *    stance today is `testimony-generator.ts`'s own-alibi-lie branch, so
 *    a "lie" line's `personId` always has a matching `Alibi` with
 *    `isTrue: false`. Each id in that alibi's `contradictingEvidenceIds`
 *    becomes one `alibi_conflict` opportunity — a REAL contradiction:
 *    `computeAlibiSupport` (alibis.ts) already checked that evidence's
 *    own timestamp/location/person fields against the claimed
 *    window/location before adding it to that list. The reaction is
 *    always `maintains_statement`: nothing in the generated model
 *    represents a predetermined "this liar breaks under pressure" state,
 *    so a lie is never auto-converted into a confession, admission, or
 *    retraction.
 *
 * 2. `stance: "omission"` / `"vague"` — for each, any `Evidence` whose
 *    `sourceEventId` equals the fact's `aboutEventId` becomes one
 *    `evidence_backed_followup` opportunity (red herrings never have a
 *    `sourceEventId`, so they can never qualify). `"omission"` reacts
 *    with `admits_omission`, `"vague"` with `clarifies_statement` — both
 *    always exactly `believedStatement` (same safe source Phase 3's
 *    `voluntary_disclosure`/`clarification` callbacks use). This is
 *    pressure to stop withholding already-known content, never a claim
 *    that anything they said was wrong.
 *
 * A `"truthful"` fact — corrupted or not — never produces an
 * opportunity: a non-corrupted truthful statement has nothing to
 * contradict, and a corrupted one has no structural proof available
 * (see `ConfrontationReactionKind`'s doc comment for why that reaction
 * was removed rather than faked).
 *
 * The culprit is deliberately NOT excluded here (unlike
 * `deriveWitnessCallbacks`): confronting a suspect's own false alibi —
 * including the real culprit's — with contradicting evidence is the
 * central use case this phase exists for.
 */
export function deriveConfrontationOpportunities(truth: CaseTruth): ConfrontationOpportunity[] {
  const knowledgeById = new Map(truth.knowledge.map((f) => [f.id, f]));
  const alibiByPersonId = new Map(truth.alibis.map((a) => [a.personId, a]));
  const evidenceByEventId = new Map<string, string[]>();
  for (const ev of truth.evidence) {
    if (ev.isRedHerring || !ev.sourceEventId) continue;
    const list = evidenceByEventId.get(ev.sourceEventId) ?? [];
    list.push(ev.id);
    evidenceByEventId.set(ev.sourceEventId, list);
  }

  const candidates: Candidate[] = [];

  for (const testimony of truth.testimony) {
    const fact = knowledgeById.get(testimony.aboutFactId);
    if (!fact) continue;

    if (testimony.stance === "lie") {
      const alibi = alibiByPersonId.get(testimony.personId);
      if (!alibi || alibi.isTrue) continue;
      for (const evidenceId of alibi.contradictingEvidenceIds) {
        candidates.push({
          factId: fact.id,
          testimonyLineId: testimony.id,
          personId: testimony.personId,
          evidenceId,
          relationKind: "alibi_conflict",
          reactionKind: "maintains_statement",
          reaction: `Je maintiens ce que j'ai déclaré : « ${alibi.claim} »`,
        });
      }
      continue;
    }

    let reactionKind: ConfrontationReactionKind | null = null;
    if (testimony.stance === "omission") reactionKind = "admits_omission";
    else if (testimony.stance === "vague") reactionKind = "clarifies_statement";
    if (!reactionKind) continue;

    const matchingEvidenceIds = evidenceByEventId.get(fact.aboutEventId) ?? [];
    if (matchingEvidenceIds.length === 0) continue;

    for (const evidenceId of matchingEvidenceIds) {
      candidates.push({
        factId: fact.id,
        testimonyLineId: testimony.id,
        personId: testimony.personId,
        evidenceId,
        relationKind: "evidence_backed_followup",
        reactionKind,
        reaction: fact.believedStatement,
      });
    }
  }

  candidates.sort((a, b) => (a.factId === b.factId ? a.evidenceId.localeCompare(b.evidenceId) : a.factId.localeCompare(b.factId)));

  return candidates.map((c) => ({
    id: `confront:${c.factId}:${c.evidenceId}`,
    personId: c.personId,
    factId: c.factId,
    testimonyLineId: c.testimonyLineId,
    evidenceId: c.evidenceId,
    relationKind: c.relationKind,
    reactionKind: c.reactionKind,
    reaction: c.reaction,
  }));
}
