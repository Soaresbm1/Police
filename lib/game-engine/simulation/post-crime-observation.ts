import type { RNG } from "../random/rng";
import type { PersonId } from "../types/person";
import type { LocationId } from "../types/location";
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
 *   testimony, relationship, or accusation/suspicion parameter anywhere in
 *   this file's public API.
 * - The caller (`case-truth.ts`) decides who is even offered to this
 *   generator (in practice: every person except the victim). This file
 *   itself never asks "is this the culprit?" — it cannot, because the
 *   question is inexpressible with the data it has.
 * - Every person is run through the exact same generation logic. There is
 *   no per-person conditional beyond "do they have a workplace".
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

export interface PostCrimeSubject {
  id: PersonId;
  firstName: string;
  lastName: string;
  homeLocationId: LocationId;
  workLocationId: LocationId | null;
}

export interface PostCrimeObservationInput {
  people: PostCrimeSubject[];
  /** The exact moment the case was opened (body discovered), taken from
   * `SimulationResult.caseOpenedAt` — never approximated from
   * `crimeTimestamp`. Not itself exposed on `CaseTruth`; the caller must
   * thread it through directly from the simulation step. */
  caseOpenedAt: GameMinutes;
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

interface RawCycle {
  wakeAt: GameMinutes;
  wakeEvent: TimelineEvent;
  workEvent: TimelineEvent | null;
  sleepAt: GameMinutes;
  sleepEvent: TimelineEvent;
}

/** One calendar-aligned day-cycle for one person: wake at home, optionally
 * go to work, sleep at home that night. Every gap between events (wake→work
 * commute, work→sleep evening, or the entire daytime for someone with no
 * workplace) is left genuinely unasserted — this never inserts a filler
 * event to claim continuous presence anywhere. The sleep event's duration
 * here is the "natural" one; `generatePersonMovements` may cap it below. */
function buildRawCycle(rng: RNG, person: PostCrimeSubject, dayStart: GameMinutes): RawCycle {
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
  } else {
    // No workplace: the entire daytime is an honest gap — we never assert
    // they simply stayed home, only that they eventually go to sleep there.
    sleepAt = wakeAt + WAKE_DURATION_MINUTES + rng.int(NO_JOB_PRE_SLEEP_GAP_MIN, NO_JOB_PRE_SLEEP_GAP_MAX);
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

  return { wakeAt, wakeEvent, workEvent, sleepAt, sleepEvent };
}

/**
 * All post-crime movements for one person, already free of same-person
 * overlaps and filtered to the true `[caseOpenedAt, caseOpenedAt +
 * COVERAGE_DAY_COUNT * MINUTES_PER_DAY)` window. See the module doc comment
 * for the exact policy.
 */
function generatePersonMovements(rng: RNG, person: PostCrimeSubject, caseOpenedAt: GameMinutes): TimelineEvent[] {
  const anchorDayStart = Math.floor(caseOpenedAt / MINUTES_PER_DAY) * MINUTES_PER_DAY;
  const coverageEnd = caseOpenedAt + COVERAGE_DAY_COUNT * MINUTES_PER_DAY;

  const cycles: RawCycle[] = [];
  for (let cycleIndex = 0; cycleIndex < INTERNAL_CYCLE_COUNT; cycleIndex++) {
    const dayStart = anchorDayStart + cycleIndex * MINUTES_PER_DAY;
    cycles.push(buildRawCycle(rng.derive(`${person.id}-day${cycleIndex}`), person, dayStart));
  }

  const events: TimelineEvent[] = [];
  for (let i = 0; i < cycles.length; i++) {
    const cycle = cycles[i];
    events.push(cycle.wakeEvent);
    if (cycle.workEvent) events.push(cycle.workEvent);

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
 * identity anywhere in this function beyond iterating the list.
 */
export function generatePostCrimeMovements(rng: RNG, input: PostCrimeObservationInput): TimelineEvent[] {
  const { people, caseOpenedAt } = input;
  const events: TimelineEvent[] = [];
  for (const person of people) {
    events.push(...generatePersonMovements(rng, person, caseOpenedAt));
  }
  return events;
}
