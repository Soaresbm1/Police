import type { RNG } from "../random/rng";
import type { Person } from "../types/person";
import { fullName } from "../types/person";
import type { Location, LocationId } from "../types/location";
import type { GameMinutes } from "../types/time";
import type { TimelineEvent, TimelineActionType } from "../types/timeline";
import type { Evidence } from "../types/evidence";
import { EVIDENCE_FAMILY_BY_TYPE } from "../types/evidence";
import type { TamperingAction, TamperingEvent } from "../types/evidence";
import type { ArchetypePolicy } from "./archetype";
import type { DifficultyConfig } from "./difficulty";
import { buildWorldContext, currentLocationAt, ensureAtLocation, makeEvent } from "../simulation/schedule";
import { clearWindowForPerson } from "../simulation/timeline-engine";

const ALL_ACTIONS: TamperingAction[] = [
  "wipe_fingerprints",
  "delete_phone_data",
  "avoid_cctv",
  "burn_clothing",
  "move_object",
  "hide_weapon",
  "send_fake_message",
  "clean_scene",
  "disguise_transaction",
];

const ACTION_TIMELINE_TYPE: Record<TamperingAction, TimelineActionType> = {
  wipe_fingerprints: "clean",
  delete_phone_data: "destroy_evidence",
  avoid_cctv: "avoid_location",
  burn_clothing: "destroy_evidence",
  move_object: "dispose_object",
  hide_weapon: "dispose_object",
  send_fake_message: "send_message",
  clean_scene: "clean",
  // "conceal_evidence" (not "other") so this action's placement event is
  // tracked by the occupancy map the same as every other tampering action —
  // "other" is reserved for untracked route waypoints and would make the
  // opportunity check unable to ever confirm this action happened.
  disguise_transaction: "conceal_evidence",
};

const ACTION_RISK: Record<TamperingAction, number> = {
  wipe_fingerprints: 0.55,
  delete_phone_data: 0.6,
  avoid_cctv: 0.4,
  burn_clothing: 0.5,
  move_object: 0.45,
  hide_weapon: 0.6,
  send_fake_message: 0.7,
  clean_scene: 0.65,
  disguise_transaction: 0.5,
};

/** 0-3 deliberate cover-up acts, difficulty- and archetype-weighted. Never
 * guaranteed even at Expert — a case with zero tampering is always a valid
 * outcome, just a less likely one at higher difficulty. */
export function decideTamperingActions(rng: RNG, config: DifficultyConfig, policy: ArchetypePolicy): TamperingAction[] {
  const chance = Math.min(0.95, config.deliberateTamperingChance * policy.tamperingChanceMultiplier);
  const count = rng.pickWeighted<0 | 1 | 2 | 3>([
    { item: 0, weight: 1 - chance },
    { item: 1, weight: chance * 0.55 },
    { item: 2, weight: chance * 0.35 },
    { item: 3, weight: chance * 0.1 },
  ]);
  if (count === 0) return [];
  return rng.sample(ALL_ACTIONS, count);
}

export interface TamperingApplication {
  timeline: TimelineEvent[];
  evidence: Evidence[];
  removedEvidenceIds: string[];
  tamperingEvents: TamperingEvent[];
}

function findAndRemove(evidence: Evidence[], predicate: (e: Evidence) => boolean): { remaining: Evidence[]; removed: Evidence | null } {
  const idx = evidence.findIndex(predicate);
  if (idx === -1) return { remaining: evidence, removed: null };
  const removed = evidence[idx];
  return { remaining: [...evidence.slice(0, idx), ...evidence.slice(idx + 1)], removed };
}

/**
 * Applies every chosen tampering action in sequence. Each one places the
 * actor at the tampering location via a real, opportunity-respecting
 * timeline event (reusing the same window-clearing guarantee as staging and
 * accomplices), optionally suppresses one existing evidence entry, and
 * always adds a secondary-trace evidence entry — the tampering can succeed
 * at hiding the original clue, but it can never hide that *something* was
 * tampered with.
 */
export function applyTampering(
  rng: RNG,
  actions: TamperingAction[],
  actor: Person,
  victim: Person,
  crimeLocationId: LocationId,
  crimeTimestamp: GameMinutes,
  locations: Location[],
  existingTimeline: TimelineEvent[],
  existingEvidence: Evidence[],
): TamperingApplication {
  let timeline = existingTimeline;
  let evidence = existingEvidence;
  const newEvidence: Evidence[] = [];
  const removedIds: string[] = [];
  const tamperingEvents: TamperingEvent[] = [];
  const locationName = locations.find((l) => l.id === crimeLocationId)?.name ?? "les lieux";
  const world = buildWorldContext(locations);
  const TRAVEL_PAD = 60;

  // Each action gets its own well-separated time slot (deterministically
  // spaced, never overlapping) so one action's window-clearing can never
  // delete an earlier action's just-inserted travel/event — the previous
  // approach of independently rolling every action's start within the same
  // ~80 minute band made that collision common once 2-3 actions were chosen.
  const SLOT_SPACING = 120;
  actions.forEach((action, i) => {
    const actionRng = rng.derive(`tampering-${action}-${i}`);
    const start = crimeTimestamp + 10 + i * SLOT_SPACING + actionRng.int(0, 30);
    const duration = actionRng.int(5, 20);
    const origin = currentLocationAt(timeline, actor, start);
    timeline = clearWindowForPerson(timeline, actor.id, start, start + duration + TRAVEL_PAD);
    const trip = ensureAtLocation(actionRng, world, actor, origin, crimeLocationId, start);
    timeline = [...timeline, ...trip.events];

    const timelineEvent = makeEvent(actionRng, {
      timestamp: trip.arriveAt,
      durationMinutes: duration,
      actorId: actor.id,
      locationId: crimeLocationId,
      action: ACTION_TIMELINE_TYPE[action],
      description: describeAction(action, actor, victim, locationName),
      presentPersonIds: [actor.id],
    });
    timeline = [...timeline, timelineEvent];

    let target: Evidence | null = null;
    switch (action) {
      case "wipe_fingerprints": {
        const res = findAndRemove(evidence, (e) => e.type === "fingerprint" && e.relatedLocationIds.includes(crimeLocationId));
        evidence = res.remaining;
        target = res.removed;
        break;
      }
      case "delete_phone_data": {
        const res = findAndRemove(
          evidence,
          (e) => (e.type === "call_log" || e.type === "sms_log") && e.relatedPersonIds.includes(actor.id),
        );
        evidence = res.remaining;
        target = res.removed;
        break;
      }
      case "hide_weapon": {
        const res = findAndRemove(evidence, (e) => e.type === "weapon" && e.relatedLocationIds.includes(crimeLocationId));
        evidence = res.remaining;
        target = res.removed;
        break;
      }
      case "clean_scene": {
        const res = findAndRemove(
          evidence,
          (e) => (e.type === "blood" || e.type === "dna") && e.relatedLocationIds.includes(crimeLocationId),
        );
        evidence = res.remaining;
        target = res.removed;
        break;
      }
      case "disguise_transaction": {
        target = evidence.find((e) => (e.type === "bank_transfer" || e.type === "cash_withdrawal") && e.relatedPersonIds.includes(actor.id)) ?? null;
        break;
      }
      default:
        target = null;
    }
    if (target) removedIds.push(target.id);

    const trace = buildSecondaryTrace(actionRng, action, actor, crimeLocationId, trip.arriveAt, locationName);
    newEvidence.push(trace);

    tamperingEvents.push({
      id: actionRng.id("tmp"),
      action,
      actorId: actor.id,
      timestamp: trip.arriveAt,
      locationId: crimeLocationId,
      costMinutes: duration,
      riskOfTrace: ACTION_RISK[action],
      targetEvidenceId: target?.id ?? null,
      secondaryTraceEvidenceId: trace.id,
      description: describeAction(action, actor, victim, locationName),
    });
  });

  return { timeline, evidence: [...evidence, ...newEvidence], removedEvidenceIds: removedIds, tamperingEvents };
}

function describeAction(action: TamperingAction, actor: Person, victim: Person, locationName: string): string {
  switch (action) {
    case "wipe_fingerprints":
      return `${fullName(actor)} essuie les surfaces à ${locationName} pour effacer ses empreintes.`;
    case "delete_phone_data":
      return `${fullName(actor)} supprime des messages et appels de son téléphone.`;
    case "avoid_cctv":
      return `${fullName(actor)} fait un détour délibéré pour éviter une caméra connue.`;
    case "burn_clothing":
      return `${fullName(actor)} brûle les vêtements portés au moment des faits.`;
    case "move_object":
      return `${fullName(actor)} déplace un objet compromettant présent sur les lieux.`;
    case "hide_weapon":
      return `${fullName(actor)} se débarrasse de l'arme utilisée contre ${fullName(victim)}.`;
    case "send_fake_message":
      return `${fullName(actor)} envoie un message depuis le téléphone de ${fullName(victim)} pour brouiller l'heure des faits.`;
    case "clean_scene":
      return `${fullName(actor)} nettoie ${locationName} à l'aide de produits ménagers puissants.`;
    case "disguise_transaction":
      return `${fullName(actor)} fractionne une transaction financière pour la rendre moins visible.`;
    default:
      return `${fullName(actor)} altère un élément lié à l'affaire.`;
  }
}

function buildSecondaryTrace(
  rng: RNG,
  action: TamperingAction,
  actor: Person,
  crimeLocationId: LocationId,
  timestamp: GameMinutes,
  locationName: string,
): Evidence {
  const descriptions: Record<TamperingAction, { type: Evidence["type"]; description: string; discoveryDifficulty: number }> = {
    wipe_fingerprints: {
      type: "tampering_trace",
      description: `Traces de nettoyage suspectes relevées sur les surfaces à ${locationName}, incompatibles avec l'entretien habituel des lieux.`,
      discoveryDifficulty: 0.5,
    },
    delete_phone_data: {
      type: "deleted_file",
      description: `Le journal d'appels de ${fullName(actor)} a été partiellement effacé ; les métadonnées de suppression sont horodatées peu après les faits.`,
      discoveryDifficulty: 0.55,
    },
    avoid_cctv: {
      type: "geolocation_log",
      description: `Le trajet de ${fullName(actor)} présente une interruption de bornage inhabituelle à proximité d'une caméra connue, cohérente avec un détour délibéré.`,
      discoveryDifficulty: 0.6,
    },
    burn_clothing: {
      type: "tampering_trace",
      description: `Des cendres de tissu ont été retrouvées près du domicile de ${fullName(actor)}, compatibles avec des vêtements brûlés récemment.`,
      discoveryDifficulty: 0.6,
    },
    move_object: {
      type: "tampering_trace",
      description: `Des marques au sol et de la poussière déplacée indiquent qu'un objet a été bougé après les faits à ${locationName}.`,
      discoveryDifficulty: 0.45,
    },
    hide_weapon: {
      type: "geolocation_log",
      description: `Le téléphone de ${fullName(actor)} borne une zone isolée peu après les faits, compatible avec le dépôt d'un objet encombrant.`,
      discoveryDifficulty: 0.6,
    },
    send_fake_message: {
      type: "tampering_trace",
      description: `Analyse technique du téléphone de la victime : un message a été envoyé après l'heure du décès estimée par le légiste.`,
      discoveryDifficulty: 0.5,
    },
    clean_scene: {
      type: "tampering_trace",
      description: `Un réactif chimique révèle des traces de produit nettoyant industriel à ${locationName}, incompatibles avec un entretien normal.`,
      discoveryDifficulty: 0.55,
    },
    disguise_transaction: {
      type: "bank_transfer",
      description: `Une transaction fractionnée de façon inhabituelle a été relevée sur le compte de ${fullName(actor)}, incohérente avec l'usage déclaré.`,
      discoveryDifficulty: 0.5,
    },
  };
  const d = descriptions[action];
  return {
    id: rng.id("ev"),
    family: EVIDENCE_FAMILY_BY_TYPE[d.type],
    type: d.type,
    sourceEventId: null,
    sourceLocationId: crimeLocationId,
    relatedPersonIds: [actor.id],
    relatedLocationIds: [crimeLocationId],
    timestamp,
    discoverableAt: timestamp,
    discoveryDifficulty: d.discoveryDifficulty,
    reliability: "reliable",
    requiresLabAnalysis: action === "delete_phone_data" ? "digital_forensics" : null,
    isRedHerring: false,
    status: "undiscovered",
    description: d.description,
  };
}
