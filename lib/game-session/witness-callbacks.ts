import type { CaseTruth } from "@/lib/game-engine/types/case";
import type { PersonId } from "@/lib/game-engine/types/person";
import type { WitnessCallbackKind } from "@/lib/game-engine/types/witness-callback";
import { deriveWitnessCallbacks } from "@/lib/game-engine/witness/witness-callbacks";
import type { GameSession } from "./types";
import { findEvent, markEventSeen, scheduleEvent } from "./events";

export type WitnessCallbackStatus = "none" | "pending" | "ready" | "seen";

export interface WitnessCallbackOutcome {
  status: WitnessCallbackStatus;
}

export interface WitnessCallbackView {
  kind: WitnessCallbackKind;
  content: string;
  status: "ready" | "seen";
}

function findCandidate(truth: CaseTruth, personId: PersonId) {
  return deriveWitnessCallbacks(truth).find((c) => c.personId === personId);
}

/**
 * The one safe projection of a witness callback's player-facing state.
 * `"none"` deliberately covers both "this witness was never eligible for a
 * callback" and "eligible, but not scheduled yet" — outside this file,
 * player-facing code never needs (or gets) to tell those two apart, which
 * is exactly what keeps `deriveWitnessCallbacks`' candidate list itself
 * safely server-only.
 */
export function describeWitnessCallback(session: GameSession, personId: PersonId): WitnessCallbackOutcome {
  const event = findEvent(session, "witness_callback", { kind: "person", id: personId });
  if (!event) return { status: "none" };
  if (event.status === "scheduled") return { status: "pending" };
  return { status: event.status };
}

/**
 * Schedules this witness's predetermined callback, if the deterministic
 * derivation produced one for them — using its precomputed, fixed delay.
 * Call this once, right after a person's first-ever interrogation answer
 * is recorded (see `actions.ts#askQuestionAction`); the interview only
 * schedules WHEN the callback becomes relevant, never WHAT it contains —
 * that was already fixed by `deriveWitnessCallbacks` at generation time.
 *
 * A witness with no eligible candidate causes no event to be scheduled at
 * all: there is nothing that can later become "ready" for them, by
 * construction, not by a hidden flag left permanently false. Idempotent
 * via the same duplicate-schedule guard every other Living Investigation
 * System event uses (`scheduleEvent`).
 */
export function scheduleWitnessCallbackIfEligible(truth: CaseTruth, session: GameSession, personId: PersonId): void {
  const candidate = findCandidate(truth, personId);
  if (!candidate) return;
  scheduleEvent(session, "witness_callback", { kind: "person", id: personId }, candidate.delayMinutes, {
    title: "TÉMOIN — Nouveau contact",
    detail: "Un témoin a recontacté le service.",
  });
}

/**
 * The callback's actual content — resolvable ONLY once its event has
 * reached `"ready"`/`"seen"`. Before that (or for a witness with no
 * callback at all), returns `null`: there is no way for calling code to
 * read `content` early, structurally, mirroring `cctv.ts`/
 * `phone-records.ts`'s deferred-reveal pattern rather than a hidden field
 * that needs guarding.
 */
export function getWitnessCallbackContent(truth: CaseTruth, session: GameSession, personId: PersonId): WitnessCallbackView | null {
  const event = findEvent(session, "witness_callback", { kind: "person", id: personId });
  if (!event || event.status === "scheduled") return null;
  const candidate = findCandidate(truth, personId);
  if (!candidate) return null;
  return { kind: candidate.kind, content: candidate.content, status: event.status };
}

/** Marks a ready callback as consumed once the player has opened it. */
export function markWitnessCallbackSeen(session: GameSession, personId: PersonId): void {
  const event = findEvent(session, "witness_callback", { kind: "person", id: personId });
  if (event) markEventSeen(session, event.id);
}
