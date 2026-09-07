import type { RNG } from "../random/rng";
import type { PersonId } from "../types/person";
import type { Relationship } from "../types/relationship";
import { RelationshipGraph } from "../types/relationship";
import type { TimelineEvent } from "../types/timeline";
import type { KnowledgeFact, TestimonyLine, TestimonyStance } from "../types/knowledge";
import type { Alibi } from "../types/case";

function isWithinAlibiWindow(event: TimelineEvent, alibi: Alibi): boolean {
  return event.timestamp >= alibi.windowStart && event.timestamp <= alibi.windowEnd;
}

export function generateTestimony(
  rng: RNG,
  facts: KnowledgeFact[],
  events: TimelineEvent[],
  relationships: Relationship[],
  culpritId: PersonId,
  alibis: Alibi[],
): TestimonyLine[] {
  const eventsById = new Map(events.map((e) => [e.id, e]));
  const alibiByPerson = new Map(alibis.map((a) => [a.personId, a]));
  const graph = new RelationshipGraph(relationships);
  const testimonyRng = rng.derive("testimony");
  const lines: TestimonyLine[] = [];

  for (const fact of facts) {
    const event = eventsById.get(fact.aboutEventId);
    if (!event) continue;

    const factRng = testimonyRng.derive(`stance-${fact.id}`);
    const ownAlibi = alibiByPerson.get(fact.personId);
    const isOwnLie =
      ownAlibi &&
      !ownAlibi.isTrue &&
      event.actorId === fact.personId &&
      isWithinAlibiWindow(event, ownAlibi);

    let stance: TestimonyStance;
    let statement: string;
    let motiveForStance: string;

    if (isOwnLie && ownAlibi) {
      stance = "lie";
      statement = ownAlibi.claim;
      motiveForStance =
        fact.personId === culpritId
          ? "dissimule sa présence sur les lieux du crime"
          : "dissimule une activité personnelle sans lien avec le crime";
    } else {
      const involvesCulprit = event.actorId === culpritId || event.counterpartyId === culpritId;
      const tieToCulprit = fact.personId !== culpritId ? graph.between(fact.personId, culpritId) : undefined;
      const protectiveBond =
        tieToCulprit && tieToCulprit.attributes.trust + tieToCulprit.attributes.affection > 0.9;

      if (involvesCulprit && protectiveBond && factRng.bool(0.4)) {
        stance = factRng.bool(0.5) ? "omission" : "vague";
        statement =
          stance === "omission"
            ? "Ne mentionne pas ce fait lors de l'audition."
            : "Reste vague et évite de donner des détails précis sur ce point.";
        motiveForStance = "protège un proche par loyauté ou par peur";
      } else {
        stance = "truthful";
        statement = fact.believedStatement;
        motiveForStance = fact.isCorrupted
          ? "erreur sincère de perception ou de mémoire, pas un mensonge"
          : "témoignage sincère";
      }
    }

    lines.push({
      id: factRng.id("testimony"),
      personId: fact.personId,
      aboutFactId: fact.id,
      stance,
      statement,
      motiveForStance,
    });
  }

  return lines;
}
