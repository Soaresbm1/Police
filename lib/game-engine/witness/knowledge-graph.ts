import type { RNG } from "../random/rng";
import type { Person } from "../types/person";
import type { Location } from "../types/location";
import type { Relationship } from "../types/relationship";
import { RelationshipGraph } from "../types/relationship";
import type { TimelineEvent } from "../types/timeline";
import type { KnowledgeFact } from "../types/knowledge";
import { formatGameTime } from "../types/time";
import { computeMemoryQuality, computePerceptionQuality, shouldCorrupt } from "./perception";
import { CAR_COLORS } from "../world/data";

function locationName(id: string, locations: Map<string, Location>): string {
  return locations.get(id)?.name ?? "un lieu";
}

/** A witness who got a good enough look remembers the canton and the
 * trailing digits of a plate, but not the letters in the middle — this is
 * what gives the vehicle registry lookup something real to search against. */
function partialPlate(plate: string): string {
  const parts = plate.split(" ");
  if (parts.length === 3) return `${parts[0]} •• ${parts[2]}`;
  return plate;
}

function buildStatement(
  event: TimelineEvent,
  observer: Person,
  actor: Person | undefined,
  knowsActor: boolean,
  locations: Map<string, Location>,
  perceptionQuality: number,
): string {
  const isVehicleSighting = event.evidenceSourceTags.includes("vehicle_sighting") && actor?.vehicle;
  if (isVehicleSighting && !knowsActor && actor?.vehicle) {
    const base = `A remarqué une voiture ${actor.vehicle.color} (${actor.vehicle.make}) près de ${locationName(event.locationId, locations)} ${formatGameTime(event.timestamp)}`;
    if (perceptionQuality > 0.7) {
      return `${base}, plaque partiellement relevée : ${partialPlate(actor.vehicle.plate)}.`;
    }
    return `${base}.`;
  }
  if (!knowsActor && actor) {
    return `A observé une personne non identifiée (${event.action}) à ${locationName(event.locationId, locations)} ${formatGameTime(event.timestamp)}.`;
  }
  return event.description;
}

function corruptStatement(rng: RNG, statement: string): string {
  const colorInStatement = CAR_COLORS.find((c) => statement.includes(c));
  if (colorInStatement) {
    const alternative = rng.pick(CAR_COLORS.filter((c) => c !== colorInStatement));
    return statement.replace(colorInStatement, alternative);
  }
  // Generic fallback: the witness commits to a plausible but slightly wrong time.
  return statement.replace(/Jour (\d+), (\d{2}):(\d{2})/, (_match, day, hh, mm) => {
    const shifted = (parseInt(mm, 10) + 15) % 60;
    return `Jour ${day}, ${hh}:${shifted.toString().padStart(2, "0")} environ`;
  });
}

export function buildKnowledgeGraph(
  rng: RNG,
  timeline: TimelineEvent[],
  people: Person[],
  locations: Location[],
  relationships: Relationship[],
): KnowledgeFact[] {
  const peopleById = new Map(people.map((p) => [p.id, p]));
  const locationsById = new Map(locations.map((l) => [l.id, l]));
  const graph = new RelationshipGraph(relationships);
  const facts: KnowledgeFact[] = [];

  for (const event of timeline) {
    if (!event.observable) continue;
    const actor = peopleById.get(event.actorId);

    for (const observerId of event.presentPersonIds) {
      const observer = peopleById.get(observerId);
      if (!observer) continue;

      const factRng = rng.derive(`fact-${event.id}-${observerId}`);
      const perceptionQuality = computePerceptionQuality(factRng.derive("perception"), observer, event);
      const memoryQuality = computeMemoryQuality(factRng.derive("memory"), observer, perceptionQuality);
      const knowsActor =
        observer.id === event.actorId ||
        observer.id === event.counterpartyId ||
        (actor ? graph.areConnected(observer.id, actor.id) : false);

      const trueStatement = event.description;
      const witnessStatement = buildStatement(event, observer, actor, knowsActor, locationsById, perceptionQuality);
      const isCorrupted = observer.id !== event.actorId && shouldCorrupt(factRng.derive("corrupt"), perceptionQuality, memoryQuality);

      facts.push({
        id: factRng.id("fact"),
        personId: observer.id,
        aboutEventId: event.id,
        trueStatement: witnessStatement === event.description ? trueStatement : witnessStatement,
        source: { kind: "direct_observation" },
        learnedAt: event.timestamp,
        perceptionQuality,
        memoryQuality,
        confidence: (perceptionQuality + memoryQuality) / 2,
        isCorrupted,
        believedStatement: isCorrupted ? corruptStatement(factRng.derive("mutate"), witnessStatement) : witnessStatement,
      });
    }
  }

  return facts;
}

/** One-hop gossip: people with strong ties to a direct witness sometimes get
 * told what that witness saw, before the case even opens. Confidence is
 * reduced and the learn time is always after the source actually knew it. */
export function propagateSecondHandKnowledge(
  rng: RNG,
  facts: KnowledgeFact[],
  people: Person[],
  relationships: Relationship[],
  caseOpenedAt: number,
): KnowledgeFact[] {
  const graph = new RelationshipGraph(relationships);
  const propagated: KnowledgeFact[] = [];
  const propagateRng = rng.derive("gossip");

  for (const fact of facts) {
    const source = people.find((p) => p.id === fact.personId);
    if (!source) continue;
    if (!propagateRng.bool(source.personality.sociability * 0.3)) continue;

    const confidants = graph
      .of(source.id)
      .filter((r) => ["friend", "spouse", "partner", "family"].includes(r.type))
      .map((r) => (r.from === source.id ? r.to : r.from));

    for (const confidantId of confidants) {
      if (!propagateRng.bool(0.4)) continue;
      const alreadyKnows = facts.some((f) => f.personId === confidantId && f.aboutEventId === fact.aboutEventId);
      if (alreadyKnows) continue;
      const learnedAt = Math.min(fact.learnedAt + propagateRng.int(30, 600), caseOpenedAt);
      if (learnedAt <= fact.learnedAt) continue;

      propagated.push({
        id: propagateRng.id("fact"),
        personId: confidantId,
        aboutEventId: fact.aboutEventId,
        trueStatement: fact.trueStatement,
        source: { kind: "told_by", personId: source.id },
        learnedAt,
        perceptionQuality: 0,
        memoryQuality: fact.memoryQuality * 0.7,
        confidence: fact.confidence * 0.6,
        isCorrupted: fact.isCorrupted,
        believedStatement: fact.believedStatement,
      });
    }
  }

  return propagated;
}
