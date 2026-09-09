import type { PersonId } from "./person";

/**
 * What relation the engine can actually PROVE between a person's
 * statement and a piece of evidence, without comparing prose:
 *
 * - `alibi_conflict`: the person's own alibi is `isTrue: false` and this
 *   evidence is one of its `Alibi.contradictingEvidenceIds` — the SAME
 *   mechanism the solvability validator already trusts for the
 *   "alibi_contradiction" channel. This is a genuine, structural
 *   contradiction: `computeAlibiSupport` already checked the evidence's
 *   own `relatedPersonIds`/`timestamp`/`relatedLocationIds` against the
 *   alibi's claimed window/location before ever adding it to that list.
 *
 * - `evidence_backed_followup`: this evidence's `sourceEventId` is the
 *   same `TimelineEvent` a person's withheld/vague `KnowledgeFact` is
 *   about. This is deliberately NOT called a contradiction — matching
 *   `sourceEventId === aboutEventId` only proves "evidence exists about
 *   the same moment this person was withholding something about", never
 *   that the evidence's content actually conflicts with what they
 *   believe. `Evidence` carries only objective structured facts about
 *   the event itself (who/where/when) — nothing about what any specific
 *   person claimed, so there is no field to check the person's belief
 *   against. It is real, legitimate leverage to press someone who was
 *   omission/vague to stop holding back — it is not proof they were
 *   wrong or lying about anything specific.
 *
 * There is deliberately no kind for "evidence contradicts a corrupted
 * (honest-but-mistaken) belief": see `ConfrontationReactionKind`'s doc
 * comment for why the current model cannot prove that structurally.
 */
export type ConfrontationRelationKind = "alibi_conflict" | "evidence_backed_followup";

/**
 * What the person does when confronted/pressed — always one
 * deterministic value per opportunity, never chosen at confrontation
 * time:
 * - `maintains_statement`: a `stance: "lie"` alibi is confronted. The
 *   model has no predetermined field for "this specific liar breaks
 *   under pressure" — so a lie is always maintained. No automatic
 *   confession.
 * - `admits_omission`: a `stance: "omission"` fact's underlying event is
 *   pressed with related evidence — the person stops withholding and
 *   states what they already believed (exactly
 *   `KnowledgeFact.believedStatement`, the same content Phase 3's
 *   `voluntary_disclosure` callback could eventually reveal on its own).
 * - `clarifies_statement`: a `stance: "vague"` fact, same treatment.
 *
 * There is deliberately no reaction for a sincerely-corrupted
 * (`isCorrupted: true`) `"truthful"` fact. An earlier draft added
 * `maintains_with_doubt`, sourced merely from evidence sharing the same
 * `TimelineEvent` — but sharing an event id only proves relevance, never
 * that the evidence's content actually conflicts with the SPECIFIC
 * detail the person misremembers (e.g. `corruptStatement` in
 * `knowledge-graph.ts` swaps a car color or shifts a time WITHIN A PROSE
 * STRING — there is no structured field recording which attribute was
 * altered, and `Evidence` has no comparable structured attribute to
 * check it against). Proving that would require either parsing prose
 * (forbidden) or a new structured field on `KnowledgeFact` (out of
 * scope for this phase, same as Phase 3's rejected `correction` kind) —
 * so this reaction, and the opportunities that would have produced it,
 * do not exist.
 */
export type ConfrontationReactionKind = "maintains_statement" | "admits_omission" | "clarifies_statement";

/**
 * Every confrontation/follow-up this case could ever produce — fixed the
 * instant this is first derived from a given `CaseTruth`, and forever
 * after: a pure function of `truth`, unaffected by anything a player
 * does, suspects, or accuses. See
 * `witness/confrontations.ts#deriveConfrontationOpportunities`.
 */
export interface ConfrontationOpportunity {
  id: string;
  personId: PersonId;
  /** The KnowledgeFact whose statement is being confronted/pressed. */
  factId: string;
  /** The originally-recorded TestimonyLine the player would have heard. */
  testimonyLineId: string;
  /** The evidence backing this opportunity. */
  evidenceId: string;
  relationKind: ConfrontationRelationKind;
  reactionKind: ConfrontationReactionKind;
  /** The person's predetermined reaction line — always copied/derived
   * from `believedStatement` (or, for a maintained lie, the existing
   * `Alibi.claim`), never from `trueStatement`. */
  reaction: string;
}
