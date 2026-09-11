import type { RNG } from "../random/rng";
import type { LifeStatus, PersonId } from "../types/person";
import type { LocationId, LocationType } from "../types/location";
import type { RelationshipType } from "../types/relationship";
import type { GameMinutes } from "../types/time";
import { MINUTES_PER_DAY, MINUTES_PER_HOUR } from "../types/time";
import { makeEvent } from "./schedule";
import type { TimelineEvent } from "../types/timeline";

/**
 * Living Investigation System Phase 5A — hardened.
 *
 * This module generates the `CaseTruth.postCrimeMovements` layer: ordinary,
 * mundane routine activity covering the 48 hours immediately following the
 * crime's discovery. It is deliberately kept separate from
 * `timeline-engine.ts` (which is never modified by this file) and, more
 * importantly, from EVERY piece of hidden case information.
 *
 * Truth-safety by construction, not just convention:
 * - `PostCrimeSubject` below is NOT `Person` — it has no `roles` field, no
 *   personality, no wealth, nothing beyond what a mundane daily routine
 *   needs. There is no `culpritId`, `victimId`, motive, evidence,
 *   testimony, or accusation/suspicion parameter anywhere in this file's
 *   public API.
 * - The caller (`case-truth.ts`) decides who is even offered to this
 *   generator (in practice: every person except the victim). This file
 *   itself never asks "is this the culprit?" — it cannot, because the
 *   question is inexpressible with the data it has.
 * - Every person is run through the exact same generation logic. There is
 *   no per-person conditional beyond "do they have a workplace" and, as of
 *   Phase 5B-2, their `lifeStatus` (age/occupation-consistent, itself
 *   already guilt-blind) and `relationshipLinks` (see below).
 *
 * Phase 5B-2 — richer optional activities — added exactly two new inputs,
 * both deliberately narrow:
 * - `PostCrimeSubject.lifeStatus`: only ever used to weight *how often* and
 *   *what kind* of optional daytime/evening activity is plausible (a
 *   retiree is more likely to run an errand than a night-shift-less
 *   employee mid-workday) — never anything about guilt.
 * - `PostCrimeSubject.relationshipLinks`: a guilt-blind projection of
 *   pre-existing relationships — `{otherPersonId, type}` ONLY, never
 *   `RelationshipAttributes` (trust/hatred/jealousy/fear/debt) and never
 *   `secret`. Used solely to pick a plausible, already-real companion for
 *   a social activity; a person with no eligible links simply never gets
 *   a social activity kind, no error, no fallback fabrication. Filtered
 *   to a fixed allow-list of mundane types (`SAFE_COMPANION_TYPES` below)
 *   — `affair`/`ex_partner`/`rival`/`conflict`/`creditor_debtor` are
 *   excluded so ordinary post-crime flavor can never itself hint at a
 *   tense or secret relationship existing.
 *
 * Phase 5B-2 hardening — reciprocal companion consistency: a social
 * activity (`"social_visit"`/`"social_meeting"`) is never written into only
 * the initiator's own movements. It's accepted only if the companion also
 * has a genuinely free, compatible interval on the same calendar cycle
 * (their two gaps' intersection, each with its own buffer already
 * enforced), and once accepted the SAME location+interval is written as
 * two separate `TimelineEvent`s — one per participant, each listing the
 * other in `presentPersonIds` — never by moving, shrinking, or overlapping
 * either person's own existing baseline events. See "reciprocal
 * coordination" below for exactly how order-independence is achieved.
 *
 * Coverage semantics (hardened):
 * - The observable window is exactly `[caseOpenedAt, caseOpenedAt +
 *   COVERAGE_DAY_COUNT * MINUTES_PER_DAY)` — starting at the exact moment
 *   the case opens, not the following midnight. This is enforced by a
 *   final filter, never by inventing continuous presence at caseOpenedAt:
 *   any internally-generated event that starts before caseOpenedAt is
 *   simply omitted (an honest gap), never clipped or used to infer
 *   presence.
 * - Internally, `INTERNAL_CYCLE_COUNT` calendar-aligned day-cycles (wake /
 *   optional work / sleep) are always generated per person, anchored at the
 *   start of the calendar day containing caseOpenedAt, regardless of what
 *   time of day caseOpenedAt falls at — enough to fully cover the 48h
 *   window no matter where in a day it begins. The final filter then keeps
 *   only events whose own start falls inside the true window.
 * - An event's recorded duration is never truncated just because the
 *   observation window ends — if its start is inside the window, it is
 *   kept whole, since it represents a real, ordinary activity whose
 *   existence doesn't depend on our observation horizon.
 * - Cross-day overlap (one day-cycle's sleep colliding with the next
 *   day-cycle's wake) is eliminated deterministically by capping a
 *   day-cycle's sleep so it always ends at least `CROSS_DAY_MIN_GAP_MINUTES`
 *   before the following cycle's wake — never by merging events or
 *   asserting continuous presence. If capping would shrink a sleep event
 *   below a sane minimum, that sleep event is omitted for that cycle
 *   entirely (a deterministic skip, not a negative/degenerate duration).
 */

export interface PostCrimeRelationshipLink {
  otherPersonId: PersonId;
  type: RelationshipType;
}

export interface PostCrimeSubject {
  id: PersonId;
  firstName: string;
  lastName: string;
  homeLocationId: LocationId;
  workLocationId: LocationId | null;
  lifeStatus: LifeStatus;
  /** Guilt-blind relationship projection — see the module doc comment.
   * Empty is always valid (a person with no eligible ties simply never
   * gets a social optional activity). */
  relationshipLinks: PostCrimeRelationshipLink[];
}

/** A public destination an optional activity can be placed at — never a
 * private home (those come from `PostCrimeSubject.homeLocationId`, only
 * ever another *known* person's own home, for `"social_visit"`). */
export interface PostCrimeLocation {
  id: LocationId;
  type: LocationType;
}

export interface PostCrimeObservationInput {
  people: PostCrimeSubject[];
  /** The exact moment the case was opened (body discovered), taken from
   * `SimulationResult.caseOpenedAt` — never approximated from
   * `crimeTimestamp`. Not itself exposed on `CaseTruth`; the caller must
   * thread it through directly from the simulation step. */
  caseOpenedAt: GameMinutes;
  /** Public infrastructure only (e.g. the town's shops/restaurants/parks)
   * — optional; an absent or empty array simply means no location-requiring
   * optional activity can ever be generated (the wake/work/sleep baseline
   * is entirely unaffected either way, see Phase 5B-2's tests). */
  publicLocations?: PostCrimeLocation[];
}

/** Fixed, seed/difficulty/relevance-independent coverage window LENGTH, in
 * days: the observation layer covers exactly the 48 hours starting at
 * `caseOpenedAt` itself. */
export const COVERAGE_DAY_COUNT = 2;

/** Always generate one more calendar-day cycle than the coverage window
 * spans, anchored at the start of caseOpenedAt's own calendar day — this
 * guarantees the true window is fully covered no matter what time of day
 * caseOpenedAt falls at (worst case: caseOpenedAt at 23:59 still needs
 * cycles for its own day plus the following two). Fixed, never a function
 * of caseOpenedAt's actual time-of-day. */
const INTERNAL_CYCLE_COUNT = COVERAGE_DAY_COUNT + 1;

const WAKE_WINDOW_START = 6 * MINUTES_PER_HOUR;
const WAKE_WINDOW_SPAN_MINUTES = 2 * MINUTES_PER_HOUR;
const WAKE_DURATION_MINUTES = 15;
const COMMUTE_GAP_MIN = 30;
const COMMUTE_GAP_MAX = 90;
const WORKDAY_MIN_HOURS = 6;
const WORKDAY_MAX_HOURS = 9;
const EVENING_GAP_MIN = 15;
const EVENING_GAP_MAX = 60;
const PRE_SLEEP_GAP_MIN = 120;
const PRE_SLEEP_GAP_MAX = 300;
const NO_JOB_PRE_SLEEP_GAP_MIN = 600;
const NO_JOB_PRE_SLEEP_GAP_MAX = 900;
const SLEEP_DURATION_MINUTES = 480;

/** Minimum gap enforced between one day-cycle's sleep and the next
 * day-cycle's wake — this is what makes cross-day overlap structurally
 * impossible, without merging events or inventing continuous presence. */
const CROSS_DAY_MIN_GAP_MINUTES = 15;

/** If capping sleep to fit before the next cycle's wake would shrink it
 * below this, the sleep event is omitted for that cycle entirely rather
 * than emitted with a degenerate/near-zero duration. Given the generator's
 * own timing ranges this floor is never actually hit, but it's kept as an
 * explicit, deterministic fallback rather than an unstated assumption. */
const MIN_SLEEP_DURATION_MINUTES = 30;

// ---------------------------------------------------------------------
// Phase 5B-2 — optional post-crime activities
//
// Design: each day-cycle has exactly one "big gap" left genuinely open by
// the baseline above — the evening gap (work end → sleep) for someone with
// a workplace, or the entire daytime (wake end → sleep) for someone
// without one. At most ONE optional activity may be placed inside that one
// gap per cycle, so across `INTERNAL_CYCLE_COUNT` (3) cycles a person gets
// at most 3 raw attempts — already comfortably inside the brief's "0-4,
// mostly 1-3, rare 4" target without needing a separate reroll-bounded
// counter. Never more than one attempt per gap; never a second attempt if
// the first one is skipped (no unbounded reroll).
//
// Reciprocal coordination (hardening pass): generation now runs in two
// passes instead of one.
//   1. `buildAllBaselines` computes every person's wake/optional-work/sleep
//      cycles first, on the exact same per-person RNG sub-streams as
//      before (`rng.derive(\`${person.id}-day${cycleIndex}\`)`) — so this
//      pass is byte-identical to the pre-hardening baseline, for anyone
//      whose day never ends up hosting a social activity.
//   2. `coordinateActivities` then walks people in a CANONICAL order —
//      sorted by `id`, never the order `input.people` happened to arrive
//      in — so the outcome can never depend on population array ordering
//      (project brief §5's explicit "first generated person wins" ban).
//      For each (person, cycle) slot not already claimed by an earlier
//      person's accepted meeting, it draws that person's own attempt/kind/
//      companion decision from that person's own RNG sub-stream (so WHICH
//      candidate proposals exist never depends on processing order either
//      — only which of two competing proposals for the same target's slot
//      wins does, and that's resolved by the same fixed canonical order).
//      A social kind is only accepted if the companion's slot for that
//      cycle is still free AND the two people's gaps (each already
//      buffered) actually overlap enough to fit the activity — in which
//      case the identical location+interval is recorded as two directed
//      events, one per participant, and BOTH slots are marked consumed.
//      Rejection is a silent, deterministic skip: no retry, no fallback to
//      a solo kind, no moving/shrinking either person's existing events.
// ---------------------------------------------------------------------

export type PostCrimeActivityKind = "social_visit" | "social_meeting" | "errand" | "leisure" | "appointment";

/** Mundane, non-secretive relationship types only — deliberately excludes
 * `affair`/`ex_partner`/`rival`/`conflict`/`creditor_debtor` so an ordinary
 * post-crime social activity can never itself hint that a tense or hidden
 * relationship exists. Guilt-blind: applied identically regardless of
 * which person happens to be the culprit (this file has no way to know). */
const SAFE_COMPANION_TYPES: ReadonlySet<RelationshipType> = new Set([
  "family",
  "spouse",
  "partner",
  "friend",
  "colleague",
  "boss",
  "employee",
  "neighbor",
  "acquaintance",
]);

/** Per-cycle probability of even attempting an optional activity in this
 * person's one eligible gap, by `lifeStatus` — see project brief §4. */
const ACTIVITY_ATTEMPT_CHANCE: Record<LifeStatus, number> = {
  student: 0.55,
  apprentice: 0.35,
  employed: 0.35,
  self_employed: 0.45,
  unemployed: 0.55,
  retired: 0.5,
};

/** Relative kind weights per `lifeStatus` — social kinds are only ever
 * offered when a companion is actually available (see `pickActivityKind`),
 * so these weights are renormalized over whichever subset applies. */
const ACTIVITY_KIND_WEIGHTS: Record<LifeStatus, Record<PostCrimeActivityKind, number>> = {
  student: { social_meeting: 3, social_visit: 2, errand: 2, leisure: 3, appointment: 1 },
  apprentice: { social_meeting: 1, social_visit: 1, errand: 2, leisure: 1, appointment: 1 },
  employed: { social_meeting: 1, social_visit: 1, errand: 2, leisure: 1, appointment: 1 },
  self_employed: { social_meeting: 2, social_visit: 1, errand: 2, leisure: 2, appointment: 1 },
  unemployed: { social_meeting: 2, social_visit: 2, errand: 3, leisure: 2, appointment: 1 },
  retired: { social_meeting: 2, social_visit: 3, errand: 2, leisure: 3, appointment: 1 },
};

/** Which public `LocationType`s a non-social-visit kind may be placed at —
 * `social_visit` always resolves to the companion's own home instead. */
const ACTIVITY_LOCATION_TYPES: Record<Exclude<PostCrimeActivityKind, "social_visit">, LocationType[]> = {
  social_meeting: ["restaurant", "bar", "park"],
  errand: ["shop", "pharmacy"],
  leisure: ["park", "restaurant", "bar"],
  appointment: ["pharmacy", "bank", "hospital"],
};

const ACTIVITY_DURATION_MINUTES: Record<PostCrimeActivityKind, [number, number]> = {
  social_visit: [45, 150],
  social_meeting: [30, 120],
  errand: [20, 60],
  leisure: [30, 120],
  appointment: [30, 90],
};

const ACTIVITY_ACTION: Record<PostCrimeActivityKind, TimelineEvent["action"]> = {
  social_visit: "meet",
  social_meeting: "meet",
  errand: "purchase",
  leisure: "other",
  appointment: "other",
};

/** Minimum buffer kept between an optional activity and its neighboring
 * events (the gap's own start/end). For a solo activity that means the
 * person's own gap boundaries; for a social one (reciprocal hardening
 * pass) it's applied to EACH participant's own gap boundary before the two
 * gaps are intersected, so the buffer is honored relative to both
 * people's own neighboring events, not just one. `30` min is a
 * deliberately generous, fixed constant — never a real per-pair
 * `travelMinutes()` calculation (post-crime-observation events don't
 * model travel legs at all, unlike the main crime-day timeline) — but
 * it's provably always ≥ the worst-case car travel time between ANY two
 * points in the engine's 8×8km town grid (`world-generator.ts#TOWN_SIZE_KM`):
 * the longest possible diagonal is ~11.3km, which even at car speed
 * (35 km/h) is ~20 minutes. So no activity this module places can ever be
 * a physically-impossible "teleport", even though `postCrimeMovements`
 * isn't read by the validator's physicality check at all (see
 * `case-validator.ts#checkTimelinePhysicality`, which only reads
 * `caseTruth.timeline`). */
const MIN_ACTIVITY_BUFFER_MINUTES = 30;

/** Caps how far into its gap an optional activity may start — keeps it
 * "soon after" the gap begins (shortly after work, or shortly after
 * waking) rather than potentially drifting into the middle of the night by
 * the time a long gap is almost over. A simple, deterministic day/night
 * plausibility heuristic (project brief §12) without modeling actual
 * clock-of-day branching. */
const MAX_ACTIVITY_OFFSET_MINUTES = 5 * MINUTES_PER_HOUR;

function pickCompanion(rng: RNG, person: PostCrimeSubject, peopleById: ReadonlyMap<PersonId, PostCrimeSubject>): PostCrimeSubject | null {
  const eligible = person.relationshipLinks
    .filter((link) => SAFE_COMPANION_TYPES.has(link.type))
    .map((link) => peopleById.get(link.otherPersonId))
    .filter((p): p is PostCrimeSubject => p !== undefined);
  return eligible.length > 0 ? rng.pick(eligible) : null;
}

function pickActivityKind(rng: RNG, status: LifeStatus, hasCompanion: boolean): PostCrimeActivityKind {
  const weights = ACTIVITY_KIND_WEIGHTS[status];
  const pool = (Object.entries(weights) as [PostCrimeActivityKind, number][]).filter(
    ([kind, weight]) => weight > 0 && (hasCompanion || (kind !== "social_visit" && kind !== "social_meeting")),
  );
  return rng.pickWeighted(pool.map(([kind, weight]) => ({ item: kind, weight })));
}

function pickPublicLocation(
  rng: RNG,
  kind: Exclude<PostCrimeActivityKind, "social_visit">,
  locations: readonly PostCrimeLocation[],
): PostCrimeLocation | null {
  const types = ACTIVITY_LOCATION_TYPES[kind];
  const matches = locations.filter((l) => types.includes(l.type));
  return matches.length > 0 ? rng.pick(matches) : null;
}

function activityDescription(kind: PostCrimeActivityKind, person: PostCrimeSubject, companion: PostCrimeSubject | null): string {
  const name = `${person.firstName} ${person.lastName}`;
  switch (kind) {
    case "social_visit":
      return `${name} rend visite à ${companion!.firstName} ${companion!.lastName}.`;
    case "social_meeting":
      return `${name} retrouve ${companion!.firstName} ${companion!.lastName}.`;
    case "errand":
      return `${name} fait une course.`;
    case "appointment":
      return `${name} a un rendez-vous.`;
    case "leisure":
      return `${name} sort un moment.`;
  }
}

/** The companion's own side of a social event's description — phrased
 * accurately from their perspective (a visit is one-directional: the
 * companion *receives* it, they don't also "rend visite à" the initiator). */
function companionActivityDescription(kind: "social_visit" | "social_meeting", companion: PostCrimeSubject, initiator: PostCrimeSubject): string {
  const name = `${companion.firstName} ${companion.lastName}`;
  return kind === "social_visit"
    ? `${name} reçoit la visite de ${initiator.firstName} ${initiator.lastName}.`
    : `${name} retrouve ${initiator.firstName} ${initiator.lastName}.`;
}

interface BaselineCycle {
  wakeAt: GameMinutes;
  wakeEvent: TimelineEvent;
  workEvent: TimelineEvent | null;
  /** The start of this cycle's one big optional-activity gap: work-end for
   * someone with a workplace, wake-end otherwise. Paired with `sleepAt` as
   * the gap's end. */
  gapStart: GameMinutes;
  sleepAt: GameMinutes;
  sleepEvent: TimelineEvent;
}

/** One calendar-aligned day-cycle's wake/optional-work/sleep baseline for
 * one person — no optional activity here; that's a separate coordination
 * pass below (`coordinateActivities`), since a social activity needs to
 * see BOTH participants' gaps before either one's events are finalized.
 * Every gap between events (wake→work commute, work→sleep evening, or the
 * entire daytime for someone with no workplace) is left genuinely
 * unasserted — this never inserts a filler event to claim continuous
 * presence. The sleep event's duration here is the "natural" one;
 * `assemblePersonMovements` may cap it below. */
function buildBaselineCycle(rng: RNG, person: PostCrimeSubject, dayStart: GameMinutes): BaselineCycle {
  const wakeAt = dayStart + rng.int(WAKE_WINDOW_START, WAKE_WINDOW_START + WAKE_WINDOW_SPAN_MINUTES);
  const wakeEvent = makeEvent(rng, {
    timestamp: wakeAt,
    durationMinutes: WAKE_DURATION_MINUTES,
    actorId: person.id,
    locationId: person.homeLocationId,
    action: "wake_up",
    description: `${person.firstName} ${person.lastName} se réveille.`,
    observable: false,
    evidenceSourceTags: [],
  });

  let workEvent: TimelineEvent | null = null;
  let sleepAt: GameMinutes;
  let gapStart: GameMinutes;

  if (person.workLocationId) {
    const workStart = wakeAt + WAKE_DURATION_MINUTES + rng.int(COMMUTE_GAP_MIN, COMMUTE_GAP_MAX);
    const workDuration = rng.int(WORKDAY_MIN_HOURS, WORKDAY_MAX_HOURS) * MINUTES_PER_HOUR;
    workEvent = makeEvent(rng, {
      timestamp: workStart,
      durationMinutes: workDuration,
      actorId: person.id,
      locationId: person.workLocationId,
      action: "work",
      description: `${person.firstName} ${person.lastName} travaille.`,
      observable: true,
      evidenceSourceTags: [],
    });
    sleepAt = workStart + workDuration + rng.int(EVENING_GAP_MIN, EVENING_GAP_MAX) + rng.int(PRE_SLEEP_GAP_MIN, PRE_SLEEP_GAP_MAX);
    gapStart = workStart + workDuration; // the evening gap: work end -> sleep
  } else {
    // No workplace: the entire daytime is an honest gap — we never assert
    // they simply stayed home, only that they eventually go to sleep there.
    sleepAt = wakeAt + WAKE_DURATION_MINUTES + rng.int(NO_JOB_PRE_SLEEP_GAP_MIN, NO_JOB_PRE_SLEEP_GAP_MAX);
    gapStart = wakeAt + WAKE_DURATION_MINUTES; // the whole daytime: wake end -> sleep
  }

  const sleepEvent = makeEvent(rng, {
    timestamp: sleepAt,
    durationMinutes: SLEEP_DURATION_MINUTES,
    actorId: person.id,
    locationId: person.homeLocationId,
    action: "sleep",
    description: person.workLocationId
      ? `${person.firstName} ${person.lastName} rentre chez lui/elle pour la nuit.`
      : `${person.firstName} ${person.lastName} passe la soirée chez soi.`,
    observable: false,
    evidenceSourceTags: [],
  });

  return { wakeAt, wakeEvent, workEvent, gapStart, sleepAt, sleepEvent };
}

/** Every person's baseline cycles, keyed by id. Each person's own cycles
 * are a pure function of their own id/lifeStatus/workLocationId and the
 * shared `caseOpenedAt` — computed independently of iteration order, so
 * this map's content never depends on `people`'s array order. */
function buildAllBaselines(rng: RNG, people: readonly PostCrimeSubject[], caseOpenedAt: GameMinutes): Map<PersonId, BaselineCycle[]> {
  const anchorDayStart = Math.floor(caseOpenedAt / MINUTES_PER_DAY) * MINUTES_PER_DAY;
  const baselines = new Map<PersonId, BaselineCycle[]>();
  for (const person of people) {
    const cycles: BaselineCycle[] = [];
    for (let cycleIndex = 0; cycleIndex < INTERNAL_CYCLE_COUNT; cycleIndex++) {
      const dayStart = anchorDayStart + cycleIndex * MINUTES_PER_DAY;
      cycles.push(buildBaselineCycle(rng.derive(`${person.id}-day${cycleIndex}`), person, dayStart));
    }
    baselines.set(person.id, cycles);
  }
  return baselines;
}

/**
 * The reciprocal-coordination pass (Phase 5B-2 hardening). Walks people in
 * a fixed canonical order — sorted by `id`, NEVER `people`'s own array
 * order — so which candidate proposals exist and which of two competing
 * proposals for the same target wins can never depend on how the caller
 * happened to order its input (project brief §5). For each (person, cycle)
 * slot not already claimed, draws that person's own attempt/companion/kind
 * decision from their own per-cycle RNG sub-stream (the exact same
 * `rng.derive(\`${person.id}-day${cycleIndex}\`).derive("optional-activity")`
 * stream the pre-hardening implementation used, so a person who ends up
 * solo or with no companion available sees byte-identical decisions to
 * before). A social kind is accepted only if the companion's own slot for
 * that cycle is still free AND the two people's gaps (each independently
 * buffered) actually intersect enough to fit the activity; on acceptance,
 * the identical location+interval is recorded as two directed events (one
 * per participant, each listing the other in `presentPersonIds`) and BOTH
 * slots are marked consumed. Rejection is a silent, deterministic skip —
 * no retry, no fallback to a solo kind, no touching either person's
 * existing baseline events.
 */
function coordinateActivities(
  rng: RNG,
  people: readonly PostCrimeSubject[],
  peopleById: ReadonlyMap<PersonId, PostCrimeSubject>,
  baselines: ReadonlyMap<PersonId, BaselineCycle[]>,
  publicLocations: readonly PostCrimeLocation[],
): Map<PersonId, (TimelineEvent | null)[]> {
  const canonicalOrder = [...people].sort((a, b) => a.id.localeCompare(b.id));
  const activityEvents = new Map<PersonId, (TimelineEvent | null)[]>(people.map((p) => [p.id, new Array<TimelineEvent | null>(INTERNAL_CYCLE_COUNT).fill(null)]));
  const consumed = new Map<PersonId, boolean[]>(people.map((p) => [p.id, new Array<boolean>(INTERNAL_CYCLE_COUNT).fill(false)]));

  for (const person of canonicalOrder) {
    const personCycles = baselines.get(person.id);
    if (!personCycles) continue;

    for (let cycleIndex = 0; cycleIndex < INTERNAL_CYCLE_COUNT; cycleIndex++) {
      if (consumed.get(person.id)![cycleIndex]) continue; // slot already used (as someone else's accepted companion)

      const cycleRng = rng.derive(`${person.id}-day${cycleIndex}`).derive("optional-activity");
      if (!cycleRng.derive("attempt").bool(ACTIVITY_ATTEMPT_CHANCE[person.lifeStatus])) continue;

      const companion = pickCompanion(cycleRng.derive("companion"), person, peopleById);
      const kind = pickActivityKind(cycleRng.derive("kind"), person.lifeStatus, companion !== null);
      const cycle = personCycles[cycleIndex];
      const isSocial = kind === "social_visit" || kind === "social_meeting";

      if (!isSocial) {
        // Solo kind: unchanged from the pre-hardening design — no
        // cross-person coordination needed (project brief §4).
        const location = pickPublicLocation(cycleRng.derive("location"), kind, publicLocations);
        if (!location) continue;
        const [minDuration, maxDuration] = ACTIVITY_DURATION_MINUTES[kind];
        const duration = cycleRng.derive("duration").int(minDuration, maxDuration);
        const earliestStart = cycle.gapStart + MIN_ACTIVITY_BUFFER_MINUTES;
        const latestStart = cycle.sleepAt - duration - MIN_ACTIVITY_BUFFER_MINUTES;
        if (latestStart < earliestStart) continue;
        const maxOffset = Math.min(latestStart - earliestStart, MAX_ACTIVITY_OFFSET_MINUTES);
        const start = earliestStart + cycleRng.derive("offset").int(0, maxOffset);
        const event = makeEvent(cycleRng.derive("event"), {
          timestamp: start,
          durationMinutes: duration,
          actorId: person.id,
          locationId: location.id,
          action: ACTIVITY_ACTION[kind],
          description: activityDescription(kind, person, null),
          presentPersonIds: [person.id],
          observable: true,
          evidenceSourceTags: [],
        });
        activityEvents.get(person.id)![cycleIndex] = event;
        consumed.get(person.id)![cycleIndex] = true;
        continue;
      }

      // Social kind: requires a companion whose own same-cycle slot is
      // still free, and whose own gap actually overlaps this person's.
      if (!companion || consumed.get(companion.id)?.[cycleIndex]) continue;
      const companionCycles = baselines.get(companion.id);
      if (!companionCycles) continue;
      const companionCycle = companionCycles[cycleIndex];

      const windowStart = Math.max(cycle.gapStart, companionCycle.gapStart) + MIN_ACTIVITY_BUFFER_MINUTES;
      const windowEnd = Math.min(cycle.sleepAt, companionCycle.sleepAt) - MIN_ACTIVITY_BUFFER_MINUTES;

      const location =
        kind === "social_visit" ? { id: companion.homeLocationId } : pickPublicLocation(cycleRng.derive("location"), kind, publicLocations);
      if (!location) continue;

      const [minDuration, maxDuration] = ACTIVITY_DURATION_MINUTES[kind];
      const duration = cycleRng.derive("duration").int(minDuration, maxDuration);
      const latestStart = windowEnd - duration;
      if (latestStart < windowStart) continue; // no interval that fits BOTH people -> reject, no one-sided event

      const maxOffset = Math.min(latestStart - windowStart, MAX_ACTIVITY_OFFSET_MINUTES);
      const start = windowStart + cycleRng.derive("offset").int(0, maxOffset);

      const eventForActor = makeEvent(cycleRng.derive("event-actor"), {
        timestamp: start,
        durationMinutes: duration,
        actorId: person.id,
        locationId: location.id,
        action: ACTIVITY_ACTION[kind],
        description: activityDescription(kind, person, companion),
        presentPersonIds: [person.id, companion.id],
        observable: true,
        evidenceSourceTags: [],
      });
      const eventForCompanion = makeEvent(cycleRng.derive("event-companion"), {
        timestamp: start,
        durationMinutes: duration,
        actorId: companion.id,
        locationId: location.id,
        action: ACTIVITY_ACTION[kind],
        description: companionActivityDescription(kind, companion, person),
        presentPersonIds: [companion.id, person.id],
        observable: true,
        evidenceSourceTags: [],
      });

      activityEvents.get(person.id)![cycleIndex] = eventForActor;
      activityEvents.get(companion.id)![cycleIndex] = eventForCompanion;
      consumed.get(person.id)![cycleIndex] = true;
      consumed.get(companion.id)![cycleIndex] = true;
    }
  }

  return activityEvents;
}

/**
 * Assembles one person's final event list from their baseline cycles plus
 * whatever the coordination pass placed in their optional-activity slots,
 * applies the existing cross-day sleep-capping rule, and filters to the
 * true `[caseOpenedAt, caseOpenedAt + COVERAGE_DAY_COUNT * MINUTES_PER_DAY)`
 * window. See the module doc comment for the exact policy.
 */
function assemblePersonMovements(
  personId: PersonId,
  cycles: readonly BaselineCycle[],
  activityEventsByCycle: readonly (TimelineEvent | null)[],
  caseOpenedAt: GameMinutes,
): TimelineEvent[] {
  const coverageEnd = caseOpenedAt + COVERAGE_DAY_COUNT * MINUTES_PER_DAY;

  const events: TimelineEvent[] = [];
  for (let i = 0; i < cycles.length; i++) {
    const cycle = cycles[i];
    events.push(cycle.wakeEvent);
    if (cycle.workEvent) events.push(cycle.workEvent);
    if (activityEventsByCycle[i]) events.push(activityEventsByCycle[i]!);

    const next = cycles[i + 1];
    let sleepDuration = cycle.sleepEvent.durationMinutes;
    if (next) {
      // Cap so this cycle's sleep always ends before the next cycle's wake
      // — the deterministic fix for cross-day overlap. A gap is fine; an
      // overlap is not.
      const maxSleepEnd = next.wakeAt - CROSS_DAY_MIN_GAP_MINUTES;
      sleepDuration = Math.min(sleepDuration, maxSleepEnd - cycle.sleepAt);
    }
    if (sleepDuration >= MIN_SLEEP_DURATION_MINUTES) {
      events.push(sleepDuration === cycle.sleepEvent.durationMinutes ? cycle.sleepEvent : { ...cycle.sleepEvent, durationMinutes: sleepDuration });
    }
  }

  // Enforce the true observation window here, at the very end — never by
  // truncating an event's duration, only by omitting events that start
  // outside it. An event whose start is inside the window keeps its full,
  // truthful duration even if that runs past coverageEnd.
  return events.filter((e) => e.timestamp >= caseOpenedAt && e.timestamp < coverageEnd);
}

/**
 * Generates `CaseTruth.postCrimeMovements` — pure function of its inputs,
 * no side effects, no reads of anything outside `PostCrimeObservationInput`.
 * Every person supplied is treated identically; there is no branch on
 * identity anywhere in this function beyond each person's own already-
 * guilt-blind `lifeStatus`/`relationshipLinks`, and — for reciprocal social
 * activities — a fixed, id-sorted canonical processing order that never
 * depends on `input.people`'s own array order (see `coordinateActivities`).
 */
export function generatePostCrimeMovements(rng: RNG, input: PostCrimeObservationInput): TimelineEvent[] {
  const { people, caseOpenedAt, publicLocations = [] } = input;
  const peopleById = new Map(people.map((p) => [p.id, p]));

  const baselines = buildAllBaselines(rng, people, caseOpenedAt);
  const activityEvents = coordinateActivities(rng, people, peopleById, baselines, publicLocations);

  const events: TimelineEvent[] = [];
  for (const person of people) {
    const cycles = baselines.get(person.id);
    if (!cycles) continue;
    events.push(...assemblePersonMovements(person.id, cycles, activityEvents.get(person.id) ?? [], caseOpenedAt));
  }
  return events;
}
