import type { CaseTruth } from "@/lib/game-engine/types/case";
import type { PersonId } from "@/lib/game-engine/types/person";
import type { GameMinutes } from "@/lib/game-engine/types/time";
import { MINUTES_PER_DAY, overlaps } from "@/lib/game-engine/types/time";
import { COVERAGE_DAY_COUNT } from "@/lib/game-engine/simulation/post-crime-observation";
import type { GameSession, SurveillanceObservation, SurveillanceRecord } from "./types";
import { findEvent, scheduleEvent } from "./events";

/**
 * V1 keeps duration deliberately constrained to a fixed menu — no
 * arbitrary free-form duration (project brief, Phase 5B-1 §2).
 */
export const SURVEILLANCE_DURATIONS_MINUTES = [120, 240, 480] as const;
export type SurveillanceDurationMinutes = (typeof SURVEILLANCE_DURATIONS_MINUTES)[number];

export function isSurveillanceDuration(value: number): value is SurveillanceDurationMinutes {
  return (SURVEILLANCE_DURATIONS_MINUTES as readonly number[]).includes(value);
}

/** Deterministic id for one surveillance request. Not just `personId`,
 * because the same person can be legitimately surveilled more than once
 * (sequentially, once an earlier window has ended) — see `surveillanceKey`'s
 * doc comment on `SurveillanceRecord` in `types.ts`. */
export function surveillanceKey(personId: PersonId, startedAt: GameMinutes): string {
  return `${personId}:${startedAt}`;
}

/** Inverse of `surveillanceKey` — `personId` never itself contains ":"
 * (see `RNG.id`'s `<prefix>_<base36>` format), so splitting on the first
 * one is safe. */
export function parseSurveillanceKey(key: string): { personId: PersonId; startedAt: GameMinutes } | null {
  const sep = key.indexOf(":");
  if (sep < 0) return null;
  const startedAt = Number(key.slice(sep + 1));
  if (!Number.isFinite(startedAt)) return null;
  return { personId: key.slice(0, sep), startedAt };
}

/**
 * Pure projection of the immutable `CaseTruth.postCrimeMovements` onto one
 * observer-safe result — the entire truth-safety boundary of this feature
 * lives here. Reads only the person's own movement events (actor or
 * present), clips every visible interval to `[windowStart, windowEnd)`,
 * and classifies each as `"arrived"`/`"departed"`/`"present"` purely from
 * whether the *real* endpoint (not the clipped one) falls inside the
 * window — see the `SurveillanceObservationType` doc comment in
 * `types.ts` for exactly what each claims and doesn't claim.
 *
 * Never invents presence in a gap, never reveals anything before
 * `windowStart` or at/after `windowEnd`, never reads anything from
 * `CaseTruth` beyond `postCrimeMovements` itself (no roles, no motive, no
 * evidence relevance) — this is the whole of what a physically-following
 * officer could actually observe.
 */
export function projectSurveillanceObservations(
  truth: CaseTruth,
  personId: PersonId,
  windowStart: GameMinutes,
  windowEnd: GameMinutes,
): SurveillanceObservation[] {
  return truth.postCrimeMovements
    .filter((e) => e.actorId === personId || e.presentPersonIds.includes(personId))
    .map((e) => ({ event: e, realEnd: e.timestamp + Math.max(1, e.durationMinutes) }))
    .filter(({ event, realEnd }) => overlaps(event.timestamp, realEnd, windowStart, windowEnd))
    .sort((a, b) => a.event.timestamp - b.event.timestamp)
    .map(({ event, realEnd }): SurveillanceObservation => {
      const arrivalWitnessed = event.timestamp >= windowStart;
      const departureWitnessed = realEnd <= windowEnd;
      // Phase 5B-2: who else the immutable event says was actually there —
      // raw person ids only, straight from `presentPersonIds`, never a
      // relationship type/secret. Omitted entirely (not an empty array)
      // when nobody else was present, so a plain solo observation's shape
      // is unchanged from before this field existed.
      const others = event.presentPersonIds.filter((id) => id !== personId);
      return {
        locationId: event.locationId,
        observedFrom: Math.max(event.timestamp, windowStart),
        observedUntil: Math.min(realEnd, windowEnd),
        observationType: arrivalWitnessed ? "arrived" : departureWitnessed ? "departed" : "present",
        ...(others.length > 0 ? { observedPersonIds: others } : {}),
      };
    });
}

export type SurveillanceRejectionReason =
  | "unknown_person"
  | "ineligible_person"
  | "before_coverage"
  | "beyond_coverage"
  | "overlapping_active";

export interface SurveillanceEligibility {
  eligible: boolean;
  reason: SurveillanceRejectionReason | null;
}

/** Shared player-facing wording for every rejection reason — the single
 * source both the server action's `lastActionMessage` and the person-page
 * option list (`player-view.ts#getSurveillanceView`) read from, so the two
 * can never drift apart. */
export const SURVEILLANCE_REJECTION_LABEL: Record<SurveillanceRejectionReason, string> = {
  unknown_person: "Personne introuvable.",
  ineligible_person: "Cette personne ne peut pas être placée sous surveillance.",
  before_coverage: "L'enquête n'est pas encore assez avancée pour surveiller.",
  beyond_coverage: "Cette durée dépasse la période actuellement observable.",
  overlapping_active: "Une surveillance est déjà en cours pour cette personne sur cette période.",
};

/**
 * V1 person eligibility (project brief §10): every non-victim person in
 * `CaseTruth.people` is already a known, non-secret entity in this game
 * (see `player-view.ts#getAllPeople`/`getBoardPalette` — there is no
 * "undiscovered person" concept anywhere in this codebase, unlike
 * evidence). So "known/discovered person" reduces to "exists, and isn't
 * the (dead) victim" — deliberately no culprit/role/motive check of any
 * kind, per the brief's explicit "no culprit logic, no hidden-role
 * filtering" instruction.
 */
export function checkPersonEligibility(truth: CaseTruth, personId: PersonId): SurveillanceEligibility {
  const person = truth.people.find((p) => p.id === personId);
  if (!person) return { eligible: false, reason: "unknown_person" };
  if (person.id === truth.victimId) return { eligible: false, reason: "ineligible_person" };
  return { eligible: true, reason: null };
}

/** The exact `[start, end)` Phase 5A actually generated data for — never
 * approximated from the movements themselves (a person's own postCrimeMovements
 * can start later than `caseOpenedAt`, e.g. if their first wake event falls
 * before it and gets filtered out — see `post-crime-observation.ts`). */
export function coverageWindow(truth: CaseTruth): { start: GameMinutes; end: GameMinutes } {
  return { start: truth.caseOpenedAt, end: truth.caseOpenedAt + COVERAGE_DAY_COUNT * MINUTES_PER_DAY };
}

/**
 * Whether a candidate `[windowStart, windowEnd)` request is even coherent
 * against this case — both the Phase 5A coverage bound (project brief §9:
 * "disallow the request if the selected surveillance duration extends past
 * available postCrimeMovements coverage") and the same-person overlap rule
 * (§11: two overlapping windows for the same person, but sequential ones
 * are always fine once the earlier one's window has actually elapsed).
 */
export function checkSurveillanceRequest(
  truth: CaseTruth,
  session: GameSession,
  personId: PersonId,
  windowStart: GameMinutes,
  windowEnd: GameMinutes,
): SurveillanceEligibility {
  const personCheck = checkPersonEligibility(truth, personId);
  if (!personCheck.eligible) return personCheck;

  const { start: coverageStart, end: coverageEnd } = coverageWindow(truth);
  if (windowStart < coverageStart) return { eligible: false, reason: "before_coverage" };
  if (windowEnd > coverageEnd) return { eligible: false, reason: "beyond_coverage" };

  const hasOverlap = Object.values(session.surveillance).some(
    (r) => r.personId === personId && overlaps(r.startedAt, r.endedAt, windowStart, windowEnd),
  );
  if (hasOverlap) return { eligible: false, reason: "overlapping_active" };

  return { eligible: true, reason: null };
}

export interface SurveillanceRequestResult {
  ok: boolean;
  reason: SurveillanceRejectionReason | null;
  record: SurveillanceRecord | null;
}

/**
 * The player-facing "place this person under surveillance" entry point.
 * Starts exactly at `session.currentTime` (never retroactive — project
 * brief §3) and, if eligible, computes and stores the SAFE observation
 * snapshot immediately (§5 — never deferred to resolution time, since by
 * then `session.currentTime` would have moved on and the window must stay
 * fixed to what it was at request time), then schedules the deferred
 * `surveillance_result` event through the existing generic scheduler —
 * `describeSurveillance` below is the only thing that may ever return the
 * stored observations to a caller, and only once that event is `"ready"`.
 * Idempotent the same way every other Living Investigation System request
 * is: re-deriving the same key twice (which can't happen here in practice,
 * since the key includes `session.currentTime`, but kept for the same
 * discipline as `scheduleEvent`) never resets anything.
 */
export function startSurveillance(
  truth: CaseTruth,
  session: GameSession,
  personId: PersonId,
  durationMinutes: SurveillanceDurationMinutes,
): SurveillanceRequestResult {
  const startedAt = session.currentTime;
  const endedAt = startedAt + durationMinutes;

  const check = checkSurveillanceRequest(truth, session, personId, startedAt, endedAt);
  if (!check.eligible) return { ok: false, reason: check.reason, record: null };

  const key = surveillanceKey(personId, startedAt);
  const existing = session.surveillance[key];
  if (existing) return { ok: true, reason: null, record: existing };

  const observations = projectSurveillanceObservations(truth, personId, startedAt, endedAt);
  const record: SurveillanceRecord = { key, personId, startedAt, endedAt, durationMinutes, observations };
  session.surveillance[key] = record;

  const person = truth.people.find((p) => p.id === personId)!;
  scheduleEvent(session, "surveillance_result", { kind: "surveillance", id: key }, durationMinutes, {
    title: "SURVEILLANCE — Rapport disponible",
    detail: `Rapport de surveillance disponible pour ${person.firstName} ${person.lastName}.`,
  });

  return { ok: true, reason: null, record };
}

export type SurveillanceStatus = "pending" | "ready" | "seen";

export interface SurveillanceOutcome {
  status: SurveillanceStatus;
  /** Only non-null once `status !== "pending"` — the stored `SurveillanceRecord`
   * already holds the computed observations the instant the request was
   * made (see `startSurveillance`), but this is the ONE safe accessor that
   * enforces they stay invisible until the deferred event actually
   * resolves. Every player-facing caller must go through this rather than
   * reading `session.surveillance[key]` directly. */
  record: SurveillanceRecord | null;
}

/** The one safe projection of a surveillance request's player-facing
 * state — mirrors `mandates.ts#describeMandateEvent`. */
export function describeSurveillance(session: GameSession, key: string): SurveillanceOutcome {
  const parsed = parseSurveillanceKey(key);
  if (!parsed) return { status: "pending", record: null };
  const event = findEvent(session, "surveillance_result", { kind: "surveillance", id: key });
  if (!event || event.status === "scheduled") return { status: "pending", record: null };
  const record = session.surveillance[key] ?? null;
  return { status: event.status, record };
}
