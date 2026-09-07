import type { CaseTruth } from "../types/case";
import { travelMinutes } from "../types/location";
import type { TimelineEvent } from "../types/timeline";
import { computeSolvability, MIN_INDEPENDENT_CHANNELS } from "./solvability";

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

  const solvability = computeSolvability(caseTruth);
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
