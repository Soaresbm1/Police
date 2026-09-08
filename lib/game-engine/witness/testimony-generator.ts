import type { RNG } from "../random/rng";
import type { PersonId } from "../types/person";
import type { Relationship } from "../types/relationship";
import { RelationshipGraph } from "../types/relationship";
import type { TimelineEvent } from "../types/timeline";
import type { KnowledgeFact, TestimonyLine, TestimonyLoyaltyReason, TestimonyStance } from "../types/knowledge";
import type { Alibi } from "../types/case";
import type { RelationshipType } from "../types/relationship";

function isWithinAlibiWindow(event: TimelineEvent, alibi: Alibi): boolean {
  return event.timestamp >= alibi.windowStart && event.timestamp <= alibi.windowEnd;
}

/** Maps the relationship type a protective witness holds toward the person
 * they're shielding onto a structured reason — distinguishing a partner,
 * a family member, a friend, and (new) an employer from one another. */
function loyaltyReasonFor(relType: RelationshipType): TestimonyLoyaltyReason {
  switch (relType) {
    case "spouse":
    case "partner":
      return "protect_partner";
    case "family":
      return "protect_family";
    case "friend":
      return "protect_friend";
    case "boss":
    case "employee":
      return "protect_employer";
    default:
      return null;
  }
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
    let loyaltyReason: TestimonyLoyaltyReason = null;

    if (isOwnLie && ownAlibi) {
      stance = "lie";
      statement = ownAlibi.claim;
      motiveForStance =
        fact.personId === culpritId
          ? "dissimule sa présence sur les lieux du crime"
          : "dissimule une activité personnelle sans lien avec le crime";
    } else {
      // Loyalty/protection is evaluated against whoever the fact is *about*
      // (the actor, or their counterparty), never restricted to the real
      // culprit — a witness protecting their employer from an unrelated
      // embarrassing fact is the same mechanic as one shielding a spouse.
      const involvedId = fact.personId !== event.actorId ? event.actorId : event.counterpartyId;
      const tie = involvedId && fact.personId !== involvedId ? graph.between(fact.personId, involvedId) : undefined;
      const bondStrength = tie ? tie.attributes.trust + tie.attributes.affection + tie.attributes.dependency * 0.5 : 0;
      const reason = tie ? loyaltyReasonFor(tie.type) : null;
      const protectiveBond = reason !== null && bondStrength > 0.85;

      if (protectiveBond && factRng.bool(0.4)) {
        stance = factRng.bool(0.5) ? "omission" : "vague";
        statement =
          stance === "omission"
            ? "Ne mentionne pas ce fait lors de l'audition."
            : "Reste vague et évite de donner des détails précis sur ce point.";
        motiveForStance = "protège un proche par loyauté ou par peur";
        loyaltyReason = reason;
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
      loyaltyReason,
    });
  }

  return lines;
}
