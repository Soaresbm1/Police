import "server-only";

import type { CaseTruth } from "../types/case";
import type { PersonId } from "../types/person";
import type { TimelineEvent } from "../types/timeline";
import {
  selectReconstructionEventChain,
  safeVisualActionForMethod,
  STAGE_SCENE_SAFE_VISUAL_ACTION,
  type CrimeEventChainResult,
  type SelectedReconstructionEvent,
} from "./reconstruction-events";
import { mapLocationTypeToEnvironment, slotForEventType, deriveActorVisualId, deriveGenericAppearance } from "./reconstruction-layout";
import {
  RECONSTRUCTION_SCHEMA_VERSION,
  type ReconstructionActor,
  type ReconstructionActorRole,
  type ReconstructionEvent,
  type ReconstructionEventType,
  type ReconstructionScenario,
} from "./reconstruction-types";

/**
 * Phase U5.1 — the ONLY function in this codebase that turns `CaseTruth`
 * into a `ReconstructionScenario`. Server-only (`import "server-only"`
 * above fails the build if any client bundle ever pulls this module in —
 * the same guarantee Next.js documents this package for). This function is
 * pure and synchronous: it takes an already-generated `CaseTruth` and an
 * externally-safe `caseId`, and returns either a scenario or a typed
 * failure — never throws, matching the "reject cleanly" convention already
 * used by `CCTVJsonLoader.TryLoad` on the Unity side (see that file).
 *
 * Truth-safety boundary (U5.0 §6/§14, this phase's explicit forbidden-field
 * list): every raw `PersonId`/`LocationId` is translated to an opaque
 * visual id or a small closed-vocabulary slot before it reaches the
 * returned scenario; `Motive`, `Relationship`, `KnowledgeFact`,
 * `TestimonyLine`, `Evidence`, raw `TimelineEvent`s, the case seed, and
 * `CaseTruth` itself never appear in the return value. See
 * `reconstruction-projector.test.ts`'s serialization-safety tests for the
 * structural + substring proof of this.
 *
 * Release gate (U5.0 §5/§23): this function does not know about
 * `investigation_sessions.accusation`, Supabase, or any session state — it
 * is the caller's responsibility (a later phase's already-`accusation`-
 * gated rapport page, exactly like `buildNarrativeReconstruction` today) to
 * only ever call this after resolution. No Server Action, API route, or
 * page wires this up yet — see this phase's own report for why.
 */

export type ProjectReconstructionResult = { ok: true; scenario: ReconstructionScenario } | { ok: false; reason: string };

interface Participation {
  time: number;
  type: ReconstructionEventType;
  durationMinutes: number;
}

// Body stays at the scene only when truth establishes it: case-opening discovery there, death before it, no later victim record.
function bodyPresenceEndMinutes(truth: CaseTruth, chain: CrimeEventChainResult): number | null {
  const discovery = chain.discover?.event;
  if (!discovery || discovery.locationId !== truth.crimeLocationId || discovery.timestamp !== truth.caseOpenedAt) return null;
  if (truth.autopsy.estimatedDeathWindowEnd > discovery.timestamp) return null;
  const attackEnd = chain.attack.event.timestamp + chain.attack.event.durationMinutes;
  const victimRecordedLater = (e: TimelineEvent) =>
    e.timestamp >= attackEnd && (e.actorId === truth.victimId || e.presentPersonIds.includes(truth.victimId));
  if (truth.timeline.some(victimRecordedLater) || truth.postCrimeMovements.some(victimRecordedLater)) return null;
  return discovery.timestamp + discovery.durationMinutes;
}

function roleFor(truth: CaseTruth, accompliceIds: ReadonlySet<PersonId>, personId: PersonId): ReconstructionActorRole {
  if (personId === truth.culpritId) return "culprit";
  if (personId === truth.victimId) return "victim";
  if (accompliceIds.has(personId)) return "accomplice";
  return "unnamed";
}

export function projectReconstruction(truth: CaseTruth, caseId: string): ProjectReconstructionResult {
  if (!caseId) {
    return { ok: false, reason: "caseId is required" };
  }
  // The case seed is spoiler-equivalent to the full CaseTruth (generateCase
  // is pure — see U5.0 §14/§16), so it must never be usable as, or equal
  // to, the reconstruction's public identifier.
  if (caseId === truth.seed) {
    return { ok: false, reason: "caseId must never be the case seed" };
  }

  const chain = selectReconstructionEventChain(truth);
  if (!chain.ok) {
    return { ok: false, reason: chain.reason };
  }

  const location = truth.locations.find((l) => l.id === truth.crimeLocationId);
  if (!location) {
    return { ok: false, reason: "crimeLocationId not found in CaseTruth.locations" };
  }
  const environment = mapLocationTypeToEnvironment(location.type);

  const orderedSelected: SelectedReconstructionEvent[] = [chain.meet, chain.attack, chain.leaveScene, chain.discover, chain.stageScene]
    .filter((sel): sel is SelectedReconstructionEvent => sel !== null)
    .sort((a, b) => a.event.timestamp - b.event.timestamp);

  if (orderedSelected.length === 0) {
    return { ok: false, reason: "no reconstructable events were found" };
  }

  const t0 = Math.min(...orderedSelected.map((sel) => sel.event.timestamp));
  const toSeconds = (gameMinutes: number): number => (gameMinutes - t0) * 60;

  const accompliceIdSet = new Set(chain.accompliceAppearances.keys());
  const bodyPresenceEnd = bodyPresenceEndMinutes(truth, chain);

  // Collect every person's participation across the anchored events —
  // as the event's actor, its counterparty, or merely present.
  const participation = new Map<PersonId, Participation[]>();
  const addParticipation = (personId: PersonId, sel: SelectedReconstructionEvent) => {
    const list = participation.get(personId) ?? [];
    list.push({ time: sel.event.timestamp, type: sel.type, durationMinutes: sel.event.durationMinutes });
    participation.set(personId, list);
  };
  for (const sel of orderedSelected) {
    const e = sel.event;
    addParticipation(e.actorId, sel);
    if (e.counterpartyId) addParticipation(e.counterpartyId, sel);
    for (const presentId of e.presentPersonIds) {
      if (presentId !== e.actorId && presentId !== e.counterpartyId) addParticipation(presentId, sel);
    }
  }

  const visualIdByPerson = new Map<PersonId, string>();
  const actors: ReconstructionActor[] = [];
  for (const [personId, rawParts] of participation.entries()) {
    const parts = [...rawParts].sort((a, b) => a.time - b.time);
    const visualId = deriveActorVisualId(caseId, personId);
    visualIdByPerson.set(personId, visualId);

    const rawWaypoints = parts.map((p) => ({ time: toSeconds(p.time), slot: slotForEventType(p.type) }));
    // Never present the same slot at the same instant twice (co-occurring
    // anchors at the same timestamp, e.g. attack+discover never happening
    // at once in practice, but staying defensive).
    const waypoints = rawWaypoints.filter(
      (wp, i) => i === 0 || wp.time !== rawWaypoints[i - 1].time || wp.slot !== rawWaypoints[i - 1].slot,
    );

    const lastPart = parts[parts.length - 1];
    const lastParticipationEnd = lastPart.time + lastPart.durationMinutes;
    const despawnMinutes =
      personId === truth.victimId && bodyPresenceEnd !== null ? Math.max(lastParticipationEnd, bodyPresenceEnd) : lastParticipationEnd;
    actors.push({
      visualId,
      roleForReconstruction: roleFor(truth, accompliceIdSet, personId),
      genericAppearance: deriveGenericAppearance(caseId, personId),
      spawnTime: waypoints[0].time,
      despawnTime: toSeconds(despawnMinutes),
      waypoints,
    });
  }
  // Deterministic output order — never insertion order, which would depend
  // on Map iteration/object-key ordering of upstream data.
  actors.sort((a, b) => a.visualId.localeCompare(b.visualId));

  const events: ReconstructionEvent[] = orderedSelected.map((sel) => {
    const e = sel.event;
    const actorVisualId = visualIdByPerson.get(e.actorId);
    if (!actorVisualId) throw new Error("internal error: reconstruction actor visual id missing for a selected event's actor");
    const counterpartyVisualId = e.counterpartyId ? visualIdByPerson.get(e.counterpartyId) : undefined;

    let safeVisualAction: string | undefined;
    if (sel.type === "attack") safeVisualAction = safeVisualActionForMethod(truth.methodType);
    else if (sel.type === "stage_scene") safeVisualAction = STAGE_SCENE_SAFE_VISUAL_ACTION;

    return {
      time: toSeconds(e.timestamp),
      type: sel.type,
      actorVisualId,
      ...(counterpartyVisualId ? { counterpartyVisualId } : {}),
      locationSlot: slotForEventType(sel.type),
      ...(safeVisualAction ? { safeVisualAction } : {}),
    };
  });

  const durationSeconds = Math.max(...orderedSelected.map((sel) => toSeconds(sel.event.timestamp + sel.event.durationMinutes)));

  const scenario: ReconstructionScenario = {
    version: RECONSTRUCTION_SCHEMA_VERSION,
    caseId,
    environment,
    durationSeconds,
    actors,
    events,
  };

  return { ok: true, scenario };
}
