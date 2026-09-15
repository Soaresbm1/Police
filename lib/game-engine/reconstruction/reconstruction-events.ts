import "server-only";

import type { CaseTruth, CrimeMethod } from "../types/case";
import type { PersonId } from "../types/person";
import type { TimelineActionType, TimelineEvent } from "../types/timeline";
import type { ReconstructionEventType } from "./reconstruction-types";

/**
 * Phase U5.1 — truth-derived event selection. This is the one place that
 * decides WHICH `TimelineEvent`s become part of a reconstruction and how
 * each maps to the small V1 taxonomy (U5.0 §8/§10/§11/§14). Marked
 * `server-only` alongside the rest of this subsystem (see
 * `reconstruction-layout.ts`'s doc comment for the boundary).
 *
 * Selection is anchor-based, not a blanket scan-by-action-type: it starts
 * from the one `isCrimeEvent === true` event and walks outward to the
 * specific preceding confrontation, the culprit's own flee, the discovery,
 * and any staging — the same handful of events `simulation/timeline-
 * engine.ts` itself constructs as one coherent chain. A blanket "every
 * `argument`/`meet` event anywhere in the timeline" scan would be unsafe:
 * `simulation/schedule.ts` also generates ordinary, unrelated `meet` events
 * for the general population's daily routine (a companion at a restaurant),
 * which could coincidentally share the crime location's id on a different
 * day. Anchoring to the crime event and requiring both location AND
 * temporal ordering relative to it avoids ever pulling in an unrelated
 * person's unconnected routine.
 */

export interface SelectedReconstructionEvent {
  event: TimelineEvent;
  type: ReconstructionEventType;
}

export interface CrimeEventChainResult {
  ok: true;
  attack: SelectedReconstructionEvent;
  meet: SelectedReconstructionEvent | null;
  leaveScene: SelectedReconstructionEvent | null;
  discover: SelectedReconstructionEvent | null;
  stageScene: SelectedReconstructionEvent | null;
  /** Accomplice ids that appear in `presentPersonIds` of one of the events
   * above, mapped to which of those events they appear in — U5.0 §18: an
   * accomplice is only ever included because a truth event actually placed
   * them at one of these anchored moments, never merely because
   * `accompliceIds` contains them. */
  accompliceAppearances: Map<PersonId, SelectedReconstructionEvent[]>;
}

export interface CrimeEventChainError {
  ok: false;
  reason: string;
}

/** Actions the ordinary daily-schedule generator also produces for
 * unrelated people (see this file's doc comment) — used only for the
 * anchor search's own internal candidate filters below, not exported. */
const CONFRONTATION_ACTIONS = new Set<TimelineActionType>(["argument", "meet"]);

export function selectReconstructionEventChain(truth: CaseTruth): CrimeEventChainResult | CrimeEventChainError {
  const crimeEvents = truth.timeline.filter((e) => e.isCrimeEvent);
  if (crimeEvents.length !== 1) {
    return { ok: false, reason: `expected exactly one isCrimeEvent===true timeline event, found ${crimeEvents.length}` };
  }
  const attackEvent = crimeEvents[0];

  if (attackEvent.actorId !== truth.culpritId) {
    return { ok: false, reason: "crime event actorId does not match CaseTruth.culpritId" };
  }
  if (attackEvent.counterpartyId !== truth.victimId) {
    return { ok: false, reason: "crime event counterpartyId does not match CaseTruth.victimId" };
  }
  if (attackEvent.locationId !== truth.crimeLocationId) {
    return { ok: false, reason: "crime event locationId does not match CaseTruth.crimeLocationId" };
  }

  const crimeLocationId = attackEvent.locationId;
  const culpritId = truth.culpritId;
  const victimId = truth.victimId;

  // The confrontation immediately preceding the attack: same location, same
  // culprit/victim dyad, strictly before the attack, closest in time to it.
  const meetCandidates = truth.timeline.filter(
    (e) =>
      CONFRONTATION_ACTIONS.has(e.action) &&
      e.locationId === crimeLocationId &&
      e.timestamp < attackEvent.timestamp &&
      e.presentPersonIds.includes(culpritId) &&
      e.presentPersonIds.includes(victimId),
  );
  const meetEvent = meetCandidates.length > 0 ? meetCandidates.reduce((a, b) => (b.timestamp > a.timestamp ? b : a)) : null;

  // The culprit's own departure from the crime location, at or after the
  // attack — earliest such leg (the actual flee, not any later unrelated trip).
  const fleeCandidates = truth.timeline.filter(
    (e) => e.action === "travel" && e.actorId === culpritId && e.locationId === crimeLocationId && e.timestamp >= attackEvent.timestamp,
  );
  const fleeEvent = fleeCandidates.length > 0 ? fleeCandidates.reduce((a, b) => (b.timestamp < a.timestamp ? b : a)) : null;

  // The discovery: an "observe" at the crime location, after the attack —
  // earliest such event (there should be exactly one per generator design,
  // but earliest-first keeps this robust rather than assuming uniqueness).
  const discoverCandidates = truth.timeline.filter(
    (e) => e.action === "observe" && e.locationId === crimeLocationId && e.timestamp > attackEvent.timestamp,
  );
  const discoverEvent = discoverCandidates.length > 0 ? discoverCandidates.reduce((a, b) => (b.timestamp < a.timestamp ? b : a)) : null;

  // Staging, only if CaseTruth actually recorded a staging attempt.
  let stageEvent: TimelineEvent | null = null;
  if (truth.staging.staged) {
    const stageCandidates = truth.timeline.filter(
      (e) => e.action === "stage_scene" && e.actorId === culpritId && e.locationId === crimeLocationId,
    );
    stageEvent = stageCandidates.length > 0 ? stageCandidates[0] : null;
  }

  const anchored: SelectedReconstructionEvent[] = [{ event: attackEvent, type: "attack" }];
  const meet: SelectedReconstructionEvent | null = meetEvent ? { event: meetEvent, type: "talk" } : null;
  if (meet) anchored.push(meet);
  const leaveScene: SelectedReconstructionEvent | null = fleeEvent ? { event: fleeEvent, type: "leave_scene" } : null;
  if (leaveScene) anchored.push(leaveScene);
  const discover: SelectedReconstructionEvent | null = discoverEvent ? { event: discoverEvent, type: "discover" } : null;
  if (discover) anchored.push(discover);
  const stageScene: SelectedReconstructionEvent | null = stageEvent ? { event: stageEvent, type: "stage_scene" } : null;
  if (stageScene) anchored.push(stageScene);

  const accompliceAppearances = new Map<PersonId, SelectedReconstructionEvent[]>();
  for (const accompliceId of truth.accompliceIds) {
    const appearances = anchored.filter((a) => a.event.presentPersonIds.includes(accompliceId));
    if (appearances.length > 0) accompliceAppearances.set(accompliceId, appearances);
  }

  return {
    ok: true,
    attack: { event: attackEvent, type: "attack" },
    meet,
    leaveScene,
    discover,
    stageScene,
    accompliceAppearances,
  };
}

/**
 * Cosmetic animation hint from the method alone (U5.0 §11) — never from
 * `TimelineEvent.description`/`involvedObject`'s free-text content, which
 * can carry more detail than is safe to project verbatim. `poisoning` and
 * `staged_overdose` deliberately share one neutral action: CaseTruth has no
 * structured field for the delivery mechanism (drink/food/injection), so
 * inventing a glass, cup, or syringe would be fabrication, not projection —
 * see this phase's explicit instruction not to invent one.
 */
const SAFE_VISUAL_ACTION_BY_METHOD: Record<CrimeMethod, string> = {
  blunt_force: "attack_strike",
  stabbing: "attack_stab",
  strangulation: "attack_strangle",
  firearm: "attack_firearm",
  fall_push: "attack_push",
  poisoning: "attack_administer_substance",
  staged_overdose: "attack_administer_substance",
};

export function safeVisualActionForMethod(methodType: CrimeMethod): string {
  return SAFE_VISUAL_ACTION_BY_METHOD[methodType];
}

/** Generic scene-manipulation cue — CaseTruth's `StagingInfo.description` is
 * prose that can name the exact staged narrative in more detail than V1
 * should project; the safe visual action stays deliberately generic. */
export const STAGE_SCENE_SAFE_VISUAL_ACTION = "manipulate_scene";

/** Action types the daily-schedule generator also produces for unrelated
 * people, i.e. never truth-load-bearing for a reconstruction on their own
 * (used only for the stress test's "unsupported action encountered"
 * frequency reporting — U5.0 §26; not used by selection logic above, which
 * is anchor-based, not a scan of every action in the timeline). */
const TAXONOMY_ACTIONS: ReadonlySet<TimelineActionType> = new Set<TimelineActionType>([
  "meet",
  "argument",
  "attack",
  "phone_call",
  "send_message",
  "travel",
  "observe",
  "stage_scene",
]);

export function isTaxonomyRelevantAction(action: TimelineActionType): boolean {
  return TAXONOMY_ACTIONS.has(action);
}
