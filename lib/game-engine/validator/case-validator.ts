import type { CaseTruth } from "../types/case";
import { travelMinutes } from "../types/location";
import type { TimelineEvent } from "../types/timeline";
import { computeSolvability, MIN_INDEPENDENT_CHANNELS } from "./solvability";
import { ARCHETYPE_POLICIES } from "../case-generator/archetype";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  solvabilityScore: number;
  difficultyScore: number;
}

interface Occupancy {
  start: number;
  end: number;
  locationId: string;
  eventId: string;
}

// "travel" events represent motion itself (occupying no single fixed point)
// and "other" is used for momentary route waypoints (e.g. driving past a gas
// station) — both would otherwise look like spurious overlaps with the
// stationary event immediately before/after them. Only stationary activities
// are checked against each other for impossible double-presence / teleport.
const STATIONARY_ACTIONS = new Set<TimelineEvent["action"]>([
  "sleep",
  "wake_up",
  "work",
  "meet",
  "phone_call",
  "send_message",
  "purchase",
  "withdraw_cash",
  "argument",
  "attack",
  "conceal_evidence",
  "destroy_evidence",
  "clean",
  "observe",
  "stage_scene",
  "dispose_object",
  "avoid_location",
]);

function buildOccupancyByPerson(timeline: TimelineEvent[]): Map<string, Occupancy[]> {
  const byPerson = new Map<string, Occupancy[]>();
  for (const event of timeline) {
    if (!STATIONARY_ACTIONS.has(event.action)) continue;
    const participants = new Set([event.actorId, ...event.presentPersonIds]);
    for (const personId of participants) {
      const list = byPerson.get(personId) ?? [];
      list.push({
        start: event.timestamp,
        end: event.timestamp + Math.max(1, event.durationMinutes),
        locationId: event.locationId,
        eventId: event.id,
      });
      byPerson.set(personId, list);
    }
  }
  for (const list of byPerson.values()) list.sort((a, b) => a.start - b.start);
  return byPerson;
}

function checkTimelinePhysicality(caseTruth: CaseTruth, errors: string[]) {
  const locationsById = new Map(caseTruth.locations.map((l) => [l.id, l]));
  const occupancyByPerson = buildOccupancyByPerson(caseTruth.timeline);

  for (const [personId, occupancies] of occupancyByPerson) {
    for (let i = 1; i < occupancies.length; i++) {
      const prev = occupancies[i - 1];
      const curr = occupancies[i];
      if (prev.locationId === curr.locationId) continue;

      const prevLocation = locationsById.get(prev.locationId);
      const currLocation = locationsById.get(curr.locationId);
      if (!prevLocation || !currLocation) {
        errors.push(`Événement référençant un lieu inconnu pour ${personId} (${prev.eventId} / ${curr.eventId})`);
        continue;
      }

      if (curr.start < prev.end) {
        errors.push(
          `Présence simultanée impossible pour ${personId} à deux lieux différents entre ${prev.eventId} et ${curr.eventId}`,
        );
        continue;
      }

      const elapsed = curr.start - prev.start;
      const minRequired = travelMinutes(prevLocation.coordinates, currLocation.coordinates, "car");
      if (elapsed < minRequired) {
        errors.push(
          `Téléportation détectée: ${personId} passe de "${prevLocation.name}" à "${currLocation.name}" en ${elapsed} min (minimum requis: ${minRequired} min)`,
        );
      }
    }
  }
}

function checkKnowledgeGraph(caseTruth: CaseTruth, errors: string[], warnings: string[]) {
  const eventsById = new Map(caseTruth.timeline.map((e) => [e.id, e]));
  const factsById = new Map(caseTruth.knowledge.map((f) => [f.id, f]));

  for (const fact of caseTruth.knowledge) {
    const event = eventsById.get(fact.aboutEventId);
    if (!event) {
      errors.push(`Fait de connaissance ${fact.id} référence un événement inexistant`);
      continue;
    }

    if (fact.source.kind === "direct_observation") {
      const wasPresent = event.actorId === fact.personId || event.presentPersonIds.includes(fact.personId);
      if (!wasPresent) {
        errors.push(
          `Connaissance impossible: ${fact.personId} prétend avoir observé directement l'événement ${event.id} sans y être présent`,
        );
      }
      if (fact.learnedAt < event.timestamp) {
        errors.push(`Connaissance impossible: ${fact.personId} connaît l'événement ${event.id} avant qu'il ne se produise`);
      }
    } else if (fact.source.kind === "told_by") {
      const sourcePersonId = fact.source.personId;
      const sourceFact = [...factsById.values()].find(
        (f) => f.personId === sourcePersonId && f.aboutEventId === fact.aboutEventId,
      );
      if (!sourceFact) {
        errors.push(`Connaissance impossible: ${fact.personId} tient un fait de ${sourcePersonId} qui ne le connaît pas`);
      } else if (sourceFact.learnedAt > fact.learnedAt) {
        errors.push(
          `Connaissance impossible: ${fact.personId} apprend le fait ${fact.aboutEventId} avant que sa source ne le sache elle-même`,
        );
      }
    }
  }

  if (caseTruth.knowledge.length === 0) {
    warnings.push("Aucun fait de connaissance généré: l'affaire risque de ne comporter aucun témoignage exploitable");
  }
}

function checkAlibis(caseTruth: CaseTruth, errors: string[], warnings: string[]) {
  const culpritAlibi = caseTruth.alibis.find((a) => a.personId === caseTruth.culpritId);
  if (!culpritAlibi) {
    warnings.push("Aucun alibi généré pour le coupable");
  } else if (culpritAlibi.isTrue && culpritAlibi.claimedLocationId !== caseTruth.crimeLocationId) {
    warnings.push("L'alibi du coupable est marqué comme vrai mais ne correspond pas au lieu du crime (scénario ambigu)");
  } else if (!culpritAlibi.isTrue && culpritAlibi.contradictingEvidenceIds.length === 0) {
    warnings.push("L'alibi mensonger du coupable n'est appuyé par aucune preuve contradictoire découvrable");
  }

  for (const alibi of caseTruth.alibis) {
    if (alibi.windowStart >= alibi.windowEnd) {
      errors.push(`Fenêtre d'alibi invalide pour ${alibi.personId}`);
    }
  }
}

function checkAccomplices(caseTruth: CaseTruth, errors: string[]) {
  const peopleIds = new Set(caseTruth.people.map((p) => p.id));
  const crimeEvent = caseTruth.timeline.find((e) => e.isCrimeEvent);

  for (const accomplice of caseTruth.accomplices) {
    if (!peopleIds.has(accomplice.personId)) {
      errors.push(`Complice ${accomplice.personId} ne fait pas partie de la population générée`);
      continue;
    }
    if (accomplice.personId === caseTruth.culpritId) {
      errors.push(`${accomplice.personId} est à la fois désigné comme coupable et comme complice`);
    }
    // An accomplice who doesn't know the full plan must never have directly
    // witnessed the crime event itself — only their own narrow slice of it.
    if (!accomplice.knowsFullPlan && crimeEvent) {
      const witnessedCrime = caseTruth.knowledge.some(
        (f) =>
          f.personId === accomplice.personId &&
          f.aboutEventId === crimeEvent.id &&
          f.source.kind === "direct_observation",
      );
      if (witnessedCrime) {
        errors.push(
          `Connaissance impossible: le/la complice ${accomplice.personId} (ne connaît pas l'ensemble du plan) a directement observé l'agression`,
        );
      }
    }
  }
}

function checkStaging(caseTruth: CaseTruth, errors: string[]) {
  if (!caseTruth.staging.staged) return;
  if (caseTruth.staging.tellEvidenceIds.length === 0) {
    errors.push(`Mise en scène (${caseTruth.staging.type}) sans aucune incohérence logique découvrable`);
    return;
  }
  const evidenceIds = new Set(caseTruth.evidence.map((e) => e.id));
  for (const tellId of caseTruth.staging.tellEvidenceIds) {
    if (!evidenceIds.has(tellId)) {
      errors.push(`La mise en scène référence une preuve de révélation inexistante (${tellId})`);
    }
  }
}

// A confession's claimed timing must genuinely conflict with the autopsy
// window — otherwise `conflictingDetail` would be pointing at a "conflict"
// that isn't actually one, and no careful player could ever catch the lie.
const FALSE_CONFESSION_MIN_DRIFT_MINUTES = 30;

function checkFalseConfession(caseTruth: CaseTruth, errors: string[]) {
  const confession = caseTruth.falseConfession;
  if (!confession) return;
  if (confession.personId === caseTruth.culpritId) {
    errors.push("La fausse confession désigne le véritable coupable comme confesseur");
  }
  if (confession.disprovingEvidenceIds.length === 0) {
    errors.push("Fausse confession sans aucune preuve permettant de la réfuter");
  }
  const evidenceIds = new Set(caseTruth.evidence.map((e) => e.id));
  for (const evId of confession.disprovingEvidenceIds) {
    if (!evidenceIds.has(evId)) {
      errors.push(`La fausse confession référence une preuve de réfutation inexistante (${evId})`);
    }
  }
  if (confession.claimedTimingStart >= confession.claimedTimingEnd) {
    errors.push("Fausse confession avec une fenêtre horaire déclarée invalide");
  }
  const driftFromDeathWindow = Math.min(
    Math.abs(confession.claimedTimingStart - caseTruth.autopsy.estimatedDeathWindowStart),
    Math.abs(confession.claimedTimingEnd - caseTruth.autopsy.estimatedDeathWindowEnd),
  );
  if (driftFromDeathWindow < FALSE_CONFESSION_MIN_DRIFT_MINUTES) {
    errors.push(
      "Fausse confession dont l'horaire déclaré ne s'écarte pas assez de la fenêtre légiste pour constituer une incohérence détectable",
    );
  }
  if (!confession.conflictingDetail) {
    errors.push("Fausse confession sans description de l'incohérence objective");
  }
}

function checkArchetypeSupport(caseTruth: CaseTruth, errors: string[]) {
  const policy = ARCHETYPE_POLICIES[caseTruth.archetype];
  if (!policy) return;
  const hasSupportingRelationship = caseTruth.relationships.some((r) => policy.preferredRelationshipTypes.includes(r.type));
  if (!hasSupportingRelationship) {
    errors.push(
      `L'archétype "${caseTruth.archetype}" n'est appuyé par aucune relation du type attendu (${policy.preferredRelationshipTypes.join(", ")}) — le graphe de relations ne soutient pas l'histoire choisie`,
    );
  }
}

/** For a false_alibi_provider accomplice, the culprit's and the
 * accomplice's alibis must actually be *coordinated*: same claimed
 * location, same claimed window, both false, and both backed by at least
 * one piece of contradicting evidence a player can find — otherwise it's
 * just two unrelated lies, not a deliberate cover story. */
function checkCoordinatedAlibi(caseTruth: CaseTruth, errors: string[]) {
  const provider = caseTruth.accomplices.find((a) => a.role === "false_alibi_provider");
  if (!provider) return;

  const culpritAlibi = caseTruth.alibis.find((a) => a.personId === caseTruth.culpritId);
  const providerAlibi = caseTruth.alibis.find((a) => a.personId === provider.personId);
  if (!culpritAlibi || !providerAlibi) {
    errors.push("Alibi concerté attendu (false_alibi_provider) mais l'un des deux alibis est manquant");
    return;
  }
  if (culpritAlibi.isTrue || providerAlibi.isTrue) {
    errors.push("Alibi concerté attendu (false_alibi_provider) mais l'un des deux alibis est marqué comme vrai");
  }
  if (
    culpritAlibi.claimedLocationId !== providerAlibi.claimedLocationId ||
    culpritAlibi.windowStart !== providerAlibi.windowStart ||
    culpritAlibi.windowEnd !== providerAlibi.windowEnd
  ) {
    errors.push("Alibi concerté incohérent: le coupable et le/la complice ne déclarent pas la même version des faits");
  }
  if (culpritAlibi.contradictingEvidenceIds.length === 0) {
    errors.push("Alibi concerté sans aucune preuve contradictoire découvrable — la coordination serait indétectable");
  }
}

function checkTamperingOpportunity(caseTruth: CaseTruth, errors: string[]) {
  const occupancyByPerson = buildOccupancyByPerson(caseTruth.timeline);
  for (const tampering of caseTruth.tamperingEvents) {
    const occupancies = occupancyByPerson.get(tampering.actorId) ?? [];
    const hadOpportunity = occupancies.some(
      (o) => o.locationId === tampering.locationId && tampering.timestamp >= o.start && tampering.timestamp < o.end,
    );
    if (!hadOpportunity) {
      errors.push(
        `Manipulation de preuve sans opportunité: ${tampering.actorId} n'était pas présent à ${tampering.locationId} au moment de l'action "${tampering.action}"`,
      );
    }
    const evidenceIds = new Set(caseTruth.evidence.map((e) => e.id));
    if (!evidenceIds.has(tampering.secondaryTraceEvidenceId)) {
      errors.push(`La manipulation "${tampering.action}" référence une trace secondaire inexistante`);
    }
  }
}

// Every evidence type derived from a timeline event can legitimately carry
// up to 2 people on its own — `deriveEvidenceFromTimeline` always includes
// the event's counterparty when there is one (a card payment made while out
// with a friend lists both diners, independent of any shared resource).
// Only a count *above* that generic baseline must be explained by an actual
// SharedResource.
const SHARED_WIDENABLE_BASELINE = 2;

function checkSharedResources(caseTruth: CaseTruth, errors: string[]) {
  if (caseTruth.sharedResources.length === 0) return;
  const ownersByResource = caseTruth.sharedResources.map((r) => new Set(r.ownerPersonIds));
  const anyGroupContains = (ids: string[]) => ownersByResource.some((owners) => ids.every((id) => owners.has(id)));

  for (const evidence of caseTruth.evidence) {
    if (evidence.relatedPersonIds.length <= SHARED_WIDENABLE_BASELINE) continue;
    if (!anyGroupContains(evidence.relatedPersonIds)) {
      errors.push(`Preuve ${evidence.id} implique plusieurs personnes sans ressource partagée les reliant toutes`);
    }
  }
}

function checkCulpritNotExonerated(solvability: ReturnType<typeof computeSolvability>, errors: string[]) {
  if (!solvability.culpritDirectlyImplicated) {
    errors.push(
      "Le véritable coupable n'est directement mis en cause par aucune preuve ni alibi contredit — l'affaire risque de l'innocenter ou de ne rendre prouvable qu'un complice",
    );
  }
}

function checkCoreFacts(caseTruth: CaseTruth, errors: string[]) {
  const peopleIds = new Set(caseTruth.people.map((p) => p.id));
  if (!peopleIds.has(caseTruth.victimId)) errors.push("La victime ne fait pas partie de la population générée");
  if (!peopleIds.has(caseTruth.culpritId)) errors.push("Le coupable ne fait pas partie de la population générée");
  if (caseTruth.victimId === caseTruth.culpritId) errors.push("La victime et le coupable sont la même personne");
  if (caseTruth.motive.holderId !== caseTruth.culpritId) errors.push("Le mobile n'est pas rattaché au coupable");
  if (caseTruth.motive.targetId !== caseTruth.victimId) errors.push("Le mobile ne cible pas la victime");
  if (!peopleIds.has(caseTruth.motive.holderId)) errors.push("Le détenteur du mobile est inconnu");
  if (caseTruth.evidence.some((e) => e.sourceEventId && !caseTruth.timeline.some((ev) => ev.id === e.sourceEventId))) {
    errors.push("Une preuve référence un événement de chronologie inexistant");
  }
}

export function validateCase(caseTruth: CaseTruth): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  checkCoreFacts(caseTruth, errors);
  checkTimelinePhysicality(caseTruth, errors);
  checkKnowledgeGraph(caseTruth, errors, warnings);
  checkAlibis(caseTruth, errors, warnings);
  checkAccomplices(caseTruth, errors);
  checkStaging(caseTruth, errors);
  checkFalseConfession(caseTruth, errors);
  checkTamperingOpportunity(caseTruth, errors);
  checkSharedResources(caseTruth, errors);
  checkArchetypeSupport(caseTruth, errors);
  checkCoordinatedAlibi(caseTruth, errors);

  const solvability = computeSolvability(caseTruth);
  checkCulpritNotExonerated(solvability, errors);
  if (solvability.independentChannels.length < MIN_INDEPENDENT_CHANNELS) {
    errors.push(
      `Affaire insuffisamment solvable: seulement ${solvability.independentChannels.length} chaîne(s) de preuve indépendante(s) (${solvability.independentChannels.join(", ") || "aucune"}), minimum requis: ${MIN_INDEPENDENT_CHANNELS}`,
    );
  }

  const difficultyScore = Math.min(
    1,
    (caseTruth.people.length / 20 + caseTruth.evidence.length / 40 + (1 - solvability.score)) / 3,
  );

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    solvabilityScore: solvability.score,
    difficultyScore,
  };
}
