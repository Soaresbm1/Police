import type { RNG } from "../random/rng";
import type { Person } from "../types/person";
import { fullName } from "../types/person";
import type { Location, LocationId } from "../types/location";
import type { GameMinutes } from "../types/time";
import type { TimelineEvent } from "../types/timeline";
import type { Evidence } from "../types/evidence";
import { EVIDENCE_FAMILY_BY_TYPE } from "../types/evidence";
import type { StagingInfo, StagingType } from "../types/case";
import type { MethodProfile } from "../simulation/crime-methods";
import type { ArchetypePolicy } from "./archetype";
import type { DifficultyConfig } from "./difficulty";
import { buildWorldContext, makeEvent, travel } from "../simulation/schedule";
import { clearWindowForPerson } from "../simulation/timeline-engine";

/** "none" is always in the pool so a case is never forced into staging just
 * because the archetype favors it — this is a bias, not a mandate. */
export function decideStaging(rng: RNG, config: DifficultyConfig, policy: ArchetypePolicy, method: MethodProfile): StagingType {
  const compatible = new Set<StagingType>(["none", ...method.compatibleStaging]);
  const weights: Partial<Record<StagingType, number>> = { none: 1 - config.stagingChance };
  for (const [type, weight] of Object.entries(policy.stagingWeights) as [StagingType, number][]) {
    if (type === "none" || !compatible.has(type)) continue;
    weights[type] = (weights[type] ?? 0) + weight * config.stagingChance;
  }
  const entries = Object.entries(weights).filter(([, w]) => (w ?? 0) > 0) as [StagingType, number][];
  if (entries.length === 0) return "none";
  return rng.pickWeighted(entries.map(([item, weight]) => ({ item, weight })));
}

export interface StagingApplication {
  info: StagingInfo;
  events: TimelineEvent[];
  evidence: Evidence[];
  autopsyNotableFeatureAdditions: string[];
}

function noStaging(existingTimeline: TimelineEvent[]): StagingApplication {
  return {
    info: { type: "none", staged: false, tellEvidenceIds: [], description: "" },
    events: existingTimeline,
    evidence: [],
    autopsyNotableFeatureAdditions: [],
  };
}

/**
 * Grafts a post-crime staging attempt onto the timeline. The true event
 * (the crime itself) is never altered — staging only ever *adds* a small
 * cluster of culprit-performed actions and, critically, at least one
 * evidence entry that logically contradicts the staged narrative (the
 * "tell"). Nothing here is a random fake clue: every tell is derived from
 * the specific staging type and the specific method actually used.
 */
export function applyStaging(
  rng: RNG,
  stagingType: StagingType,
  culprit: Person,
  victim: Person,
  crimeLocationId: LocationId,
  crimeTimestamp: GameMinutes,
  method: MethodProfile,
  locations: Location[],
  existingTimeline: TimelineEvent[],
): StagingApplication {
  if (stagingType === "none") return noStaging(existingTimeline);

  const stagingRng = rng.derive("staging");
  const start = crimeTimestamp + stagingRng.int(3, 15);
  const duration = stagingRng.int(5, 15);

  // Staging happens at the scene, right after the attack and before the
  // culprit's original flee-home sequence — which may have been scheduled
  // to start anywhere in a heavily-overlapping window. Rather than risk
  // truncating that original travel leg mid-flight (leaving the culprit
  // teleporting home with no bridging trip), clear generously through a
  // full night's sleep and rebuild a clean staging -> travel home -> sleep
  // tail from scratch.
  const clearEnd = start + duration + 600;
  let timeline = clearWindowForPerson(existingTimeline, culprit.id, start, clearEnd);

  const stageEvent = makeEvent(stagingRng, {
    timestamp: start,
    durationMinutes: duration,
    actorId: culprit.id,
    locationId: crimeLocationId,
    action: "stage_scene",
    description: describeStagingAction(stagingType, culprit, victim, locations, crimeLocationId, stagingRng),
    presentPersonIds: [culprit.id],
    observable: false,
  });
  timeline = [...timeline, stageEvent];

  const world = buildWorldContext(locations);
  const homeTrip = travel(stagingRng, world, culprit, crimeLocationId, culprit.homeLocationId, start + duration);
  timeline = [...timeline, ...homeTrip.events];
  timeline = [
    ...timeline,
    makeEvent(stagingRng, {
      timestamp: homeTrip.arriveAt,
      durationMinutes: 480,
      actorId: culprit.id,
      locationId: culprit.homeLocationId,
      action: "sleep",
      description: `${fullName(culprit)} rentre chez lui/elle pour la nuit.`,
      observable: false,
    }),
  ];

  const tell = buildTellEvidence(stagingRng, stagingType, method, crimeLocationId, start);

  return {
    info: {
      type: stagingType,
      staged: true,
      tellEvidenceIds: [tell.id],
      description: STAGING_LABEL[stagingType],
    },
    events: timeline,
    evidence: [tell],
    autopsyNotableFeatureAdditions: [AUTOPSY_TELL[stagingType]],
  };
}

const STAGING_LABEL: Record<Exclude<StagingType, "none">, string> = {
  burglary: "Mise en scène d'un cambriolage",
  suicide: "Mise en scène d'un suicide",
  accident: "Mise en scène d'un accident",
  robbery_gone_wrong: "Mise en scène d'un vol ayant mal tourné",
};

const AUTOPSY_TELL: Record<Exclude<StagingType, "none">, string> = {
  burglary: "désordre du lieu incohérent avec un cambriolage réel (objets de valeur visibles non emportés)",
  suicide: "absence de marques d'hésitation, atypique pour un geste auto-infligé",
  accident: "lividité cadavérique incompatible avec la position du corps retrouvée",
  robbery_gone_wrong: "aucune empreinte étrangère relevée malgré un vol apparent",
};

function describeStagingAction(
  type: StagingType,
  culprit: Person,
  victim: Person,
  locations: Location[],
  crimeLocationId: LocationId,
  rng: RNG,
): string {
  const location = locations.find((l) => l.id === crimeLocationId);
  const locationName = location?.name ?? "les lieux";
  switch (type) {
    case "burglary":
      return `${fullName(culprit)} met du désordre à ${locationName} et emporte quelques objets pour simuler un cambriolage.`;
    case "suicide":
      return `${fullName(culprit)} replace l'arme près de ${fullName(victim)} pour suggérer un geste volontaire.`;
    case "accident":
      return `${fullName(culprit)} déplace le corps et renverse du mobilier pour simuler une chute accidentelle.`;
    case "robbery_gone_wrong":
      return `${fullName(culprit)} force une serrure et vide un tiroir pour donner l'apparence d'un vol qui aurait mal tourné.`;
    default:
      void rng;
      return `${fullName(culprit)} altère la scène à ${locationName}.`;
  }
}

function buildTellEvidence(
  rng: RNG,
  type: StagingType,
  method: MethodProfile,
  crimeLocationId: LocationId,
  timestamp: GameMinutes,
): Evidence {
  const descriptions: Record<Exclude<StagingType, "none">, string> = {
    burglary: `Le désordre relevé sur les lieux ne correspond pas à un cambriolage réel : des objets de valeur bien visibles n'ont pas été emportés.`,
    suicide: `L'analyse légiste relève l'absence de plaies ou marques d'hésitation, pourtant systématiques en cas de geste auto-infligé par ${method.weapon}.`,
    accident: `Des traces au sol indiquent que le corps a été déplacé après le décès, incompatible avec une chute accidentelle sur place.`,
    robbery_gone_wrong: `Aucune empreinte étrangère aux occupants n'a été relevée sur les objets prétendument dérobés.`,
  };
  const stagingType = type as Exclude<StagingType, "none">;
  return {
    id: rng.id("ev"),
    family: EVIDENCE_FAMILY_BY_TYPE.staging_tell,
    type: "staging_tell",
    sourceEventId: null,
    sourceLocationId: crimeLocationId,
    relatedPersonIds: [],
    relatedLocationIds: [crimeLocationId],
    timestamp,
    discoverableAt: timestamp,
    discoveryDifficulty: 0.55,
    reliability: "reliable",
    requiresLabAnalysis: null,
    isRedHerring: false,
    status: "undiscovered",
    description: descriptions[stagingType],
  };
}
