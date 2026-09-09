import type { CaseTruth } from "../types/case";
import type { WitnessCallback, WitnessCallbackKind } from "../types/witness-callback";
import { createRootRng } from "../random/rng";

const MIN_DELAY_MINUTES = 90;
const MAX_DELAY_MINUTES = 240;
/** Per-candidate odds of actually becoming a scheduled callback. Kept low
 * and per-witness (never per-case) so most cases produce zero or one
 * callback, occasionally two, and three only when an unusually high number
 * of witnesses happen to have eligible material. */
const CALLBACK_CHANCE = 0.15;
const MAX_CALLBACKS_PER_CASE = 3;

interface Candidate {
  factId: string;
  testimonyLineId: string;
  personId: string;
  kind: WitnessCallbackKind;
  content: string;
}

/**
 * Every witness callback this case could ever produce — fixed the instant
 * this is first called for a given `CaseTruth`, and forever after: a pure
 * function of `truth`, so the same case always yields the same list
 * regardless of anything a player does. This is the truth-safety boundary
 * for the whole callback system: content is never generated here, only
 * selected — and every candidate's `content` is always exactly
 * `KnowledgeFact.believedStatement`, i.e. what that person *themselves*
 * currently believes (their own epistemic state, corrupted or not — see
 * `KnowledgeFact`'s doc comment), never `trueStatement`. A callback can
 * only ever surface a fact a witness already privately knows/believes;
 * it can never repair their memory using CaseTruth's own omniscience.
 *
 * Candidate sourcing, by original testimony stance (see
 * `witness/testimony-generator.ts`):
 * - `stance: "omission"` (a fact the witness fully knows but chose not to
 *   mention, always out of loyalty to someone — see `loyaltyReason`) →
 *   `voluntary_disclosure`: they later choose to stop protecting that
 *   person and volunteer what they already knew (still exactly
 *   `believedStatement` — if their belief happens to be corrupted, the
 *   disclosure is corrupted too, since it's their own account, not a
 *   ground-truth report).
 * - `stance: "vague"` (same loyalty motive, but they did gesture at the
 *   topic without precision) → `clarification`: they later give the exact
 *   version of what they were vague about — again their own
 *   `believedStatement`, same caveat.
 *
 * There is deliberately no `correction` kind. An earlier draft sourced one
 * from `stance: "truthful"` facts with `isCorrupted: true`, surfacing
 * `trueStatement` as a "later realization" — but `KnowledgeFact` has no
 * field representing a witness's own, independently predetermined
 * capacity to later recover the accurate version; `trueStatement` is
 * CaseTruth's ground truth, not something *this person* has ever been
 * shown to hold. Using it would let a callback repair a witness's memory
 * via the engine's omniscience rather than via anything the witness
 * themselves is modeled as knowing — exactly the failure mode Phase 3's
 * truth-safety rule forbids. A corrupted fact stays corrupted unless/until
 * a future, dedicated memory-evolution model explicitly represents that a
 * specific person can recover it; this patch does not invent one.
 *
 * There is also no `remembered_detail` kind: the current knowledge model
 * has no notion of a partial, non-loyalty-driven omission distinct from
 * `voluntary_disclosure` (a "truthful" stance always reports a fact's full
 * `believedStatement`, never a partial slice of it) — see the Phase 3
 * audit report for this gap.
 *
 * Eligibility spans every non-culprit person who has at least one
 * `KnowledgeFact`+`TestimonyLine` pair with a qualifying stance — in
 * practice witnesses and non-culprit suspects/accomplices (anyone with
 * `roles.push("bystander")` has zero knowledge facts by construction, so
 * they never produce a candidate). Deliberately excludes only the
 * culprit: this models a witness recontacting police about something
 * *they* noticed, never the culprit re-litigating their own cover story —
 * that stays governed by the existing alibi/testimony-lie model and must
 * never be reframed as an innocent "callback".
 */
export function deriveWitnessCallbacks(truth: CaseTruth): WitnessCallback[] {
  const rng = createRootRng(truth.seed).derive("witness-callbacks");
  const testimonyByFactId = new Map(truth.testimony.map((t) => [t.aboutFactId, t]));

  const candidates: Candidate[] = [];
  for (const fact of truth.knowledge) {
    if (fact.personId === truth.culpritId) continue;
    const testimony = testimonyByFactId.get(fact.id);
    if (!testimony) continue;

    if (testimony.stance === "omission") {
      candidates.push({
        factId: fact.id,
        testimonyLineId: testimony.id,
        personId: fact.personId,
        kind: "voluntary_disclosure",
        content: fact.believedStatement,
      });
    } else if (testimony.stance === "vague") {
      candidates.push({
        factId: fact.id,
        testimonyLineId: testimony.id,
        personId: fact.personId,
        kind: "clarification",
        content: fact.believedStatement,
      });
    }
  }

  // Deterministic order before rolling — never depends on array/Map
  // iteration order, only on the (immutable) fact ids themselves.
  candidates.sort((a, b) => a.factId.localeCompare(b.factId));

  // At most one callback per witness: a witness recontacting police about
  // several things at once isn't the "uncommon, single follow-up" shape
  // this system targets (see Phase 3 requirement 7).
  const chosenPersonIds = new Set<string>();
  const result: WitnessCallback[] = [];
  for (const candidate of candidates) {
    if (result.length >= MAX_CALLBACKS_PER_CASE) break;
    if (chosenPersonIds.has(candidate.personId)) continue;
    if (!rng.bool(CALLBACK_CHANCE)) continue;
    chosenPersonIds.add(candidate.personId);
    result.push({
      id: `callback:${candidate.factId}`,
      personId: candidate.personId,
      kind: candidate.kind,
      factId: candidate.factId,
      testimonyLineId: candidate.testimonyLineId,
      content: candidate.content,
      delayMinutes: rng.int(MIN_DELAY_MINUTES, MAX_DELAY_MINUTES),
    });
  }

  return result;
}
