import type { RNG } from "../random/rng";
import type { Person, PersonId } from "../types/person";
import { fullName } from "../types/person";
import type { Relationship } from "../types/relationship";
import { RelationshipGraph } from "../types/relationship";
import type { Motive, MotiveType } from "../types/case";

export interface MotiveCandidate {
  holderId: PersonId;
  targetId: PersonId;
  type: MotiveType;
  strength: number;
  description: string;
  groundingRelationshipIds: string[];
}

function clip01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** How much a relationship, seen from the `to` person's perspective, makes
 * them a plausible target (i.e. a good victim). */
function directedRiskWeight(rel: Relationship): number {
  const a = rel.attributes;
  let weight = a.hatred * 2 + a.jealousy * 1.5 + a.fear * 0.5;
  if (a.debtChf > 20_000) weight += 1;
  if (rel.type === "affair" || rel.type === "ex_partner" || rel.type === "conflict" || rel.type === "rival") {
    weight += 0.5;
  }
  return weight;
}

export function computeVictimRiskScore(personId: PersonId, graph: RelationshipGraph): number {
  let score = 0;
  for (const rel of graph.of(personId)) {
    // Only count relationships where this person is on the receiving end of
    // the negative attributes (they're the object of someone else's grudge).
    if (rel.to === personId) score += directedRiskWeight(rel);
    else score += directedRiskWeight(rel) * 0.3;
  }
  return score;
}

/** Picks a victim guaranteed to have at least one real motive candidate
 * against them — selection is driven directly by the same rules that will
 * later produce the culprit's motive, rather than a separate heuristic that
 * could disagree with them and leave the case unsolvable to generate. */
export function selectVictim(rng: RNG, people: Person[], relationships: Relationship[]): Person {
  const graph = new RelationshipGraph(relationships);
  const scored = people.map((person) => {
    const candidates = deriveMotiveCandidates(person, people, relationships);
    const candidateStrength = candidates.reduce((sum, c) => sum + c.strength, 0);
    const risk = computeVictimRiskScore(person.id, graph);
    return { person, candidateCount: candidates.length, weight: candidateStrength + risk * 0.1 };
  });

  const viable = scored.filter((s) => s.candidateCount > 0);
  if (viable.length === 0) {
    throw new Error("selectVictim: no person in the population has any viable motive candidate against them");
  }
  return rng.pickWeighted(viable.map((s) => ({ item: s.person, weight: s.weight + 0.1 })));
}

function directMotiveFromRelationship(
  holder: Person,
  victim: Person,
  rel: Relationship,
): MotiveCandidate | null {
  const holderIsFrom = rel.from === holder.id;
  const a = rel.attributes;
  const base = { holderId: holder.id, targetId: victim.id, groundingRelationshipIds: [rel.id] };

  switch (rel.type) {
    case "spouse":
    case "partner": {
      if (a.jealousy > 0.55 || a.hatred > 0.5) {
        return {
          ...base,
          type: a.jealousy > a.hatred ? "jealousy" : "crime_passionnel",
          strength: clip01((a.jealousy + a.hatred) / 2),
          description: `${fullName(holder)} entretient une relation conjugale dégradée avec ${fullName(victim)}, marquée par la jalousie et les tensions.`,
        };
      }
      return null;
    }
    case "ex_partner": {
      if (a.hatred > 0.4 || a.jealousy > 0.4) {
        return {
          ...base,
          type: a.jealousy >= a.hatred ? "jealousy" : "revenge",
          strength: clip01((a.hatred + a.jealousy) / 1.6),
          description: `${fullName(holder)} et ${fullName(victim)} sont d'ex-partenaires en froid, avec une rupture mal digérée.`,
        };
      }
      return null;
    }
    case "affair": {
      if (a.fear > 0.35) {
        return {
          ...base,
          type: "secret_exposure",
          strength: clip01(a.fear * 0.9 + a.affection * 0.2),
          description: `${fullName(holder)} a une liaison cachée avec ${fullName(victim)} et craint qu'elle ne soit révélée.`,
        };
      }
      return null;
    }
    case "creditor_debtor": {
      // holder owes money to victim: classic fear-of-denunciation motive.
      if (holderIsFrom && a.debtChf > 15_000) {
        const exposureRisk = rel.secret ? 0.3 : 0;
        return {
          ...base,
          type: a.fear > 0.5 ? "fear_of_denunciation" : "debt",
          strength: clip01((a.debtChf / 100_000) * 0.6 + a.fear * 0.3 + exposureRisk),
          description: `${fullName(holder)} doit ${a.debtChf.toLocaleString("fr-CH")} CHF à ${fullName(victim)}${
            rel.secret ? ", qui menace de le dénoncer" : ""
          }.`,
        };
      }
      if (!holderIsFrom && a.debtChf > 40_000 && a.trust < 0.3) {
        return {
          ...base,
          type: "money",
          strength: clip01((a.debtChf / 150_000) * 0.4),
          description: `${fullName(victim)} doit une somme importante à ${fullName(holder)}, qui n'a plus confiance en un remboursement.`,
        };
      }
      return null;
    }
    case "family": {
      if (victim.wealthChf > 250_000 && (a.dependency > 0.4 || a.trust < 0.35)) {
        return {
          ...base,
          type: "inheritance",
          strength: clip01((victim.wealthChf / 900_000) * 0.5 + a.dependency * 0.3),
          description: `${fullName(holder)} est un proche de ${fullName(victim)} et pourrait hériter d'un patrimoine conséquent.`,
        };
      }
      return null;
    }
    case "boss": {
      // rel.from = boss, rel.to = employee
      if (rel.from === victim.id && a.trust < 0.3) {
        return {
          ...base,
          type: "professional_conflict",
          strength: clip01(0.3 + (0.3 - a.trust)),
          description: `${fullName(holder)} est en conflit professionnel avec son supérieur ${fullName(victim)}.`,
        };
      }
      if (rel.to === victim.id && a.trust < 0.25) {
        return {
          ...base,
          type: "fraud",
          strength: clip01(0.25 + (0.25 - a.trust)),
          description: `${fullName(holder)} soupçonne ${fullName(victim)} de malversations menaçant son emploi ou son entreprise.`,
        };
      }
      return null;
    }
    case "rival":
    case "conflict": {
      if (a.hatred > 0.35) {
        return {
          ...base,
          type: "rivalry",
          strength: clip01(a.hatred * 0.8),
          description: `${fullName(holder)} est en rivalité ouverte avec ${fullName(victim)}.`,
        };
      }
      return null;
    }
    default:
      return null;
  }
}

/** Deeper, network-level motive: holder has a secret affair with a third
 * person P, and the victim is P's spouse/partner — i.e. the victim is the
 * one who could expose (or already threatens to expose) the affair. */
function affairTriangleMotives(
  holder: Person,
  victim: Person,
  graph: RelationshipGraph,
): MotiveCandidate[] {
  const results: MotiveCandidate[] = [];
  for (const rel of graph.of(holder.id)) {
    if (rel.type !== "affair") continue;
    const partnerId = rel.from === holder.id ? rel.to : rel.from;
    const partnerLink = graph
      .of(partnerId)
      .find((r) => (r.type === "spouse" || r.type === "partner") && (r.from === victim.id || r.to === victim.id));
    if (!partnerLink) continue;
    results.push({
      holderId: holder.id,
      targetId: victim.id,
      type: "secret_exposure",
      strength: clip01(rel.attributes.fear * 0.7 + 0.25),
      description: `${fullName(holder)} entretient une liaison secrète avec le/la partenaire de ${fullName(victim)} et redoute que cela soit découvert.`,
      groundingRelationshipIds: [rel.id, partnerLink.id],
    });
  }
  return results;
}

export function deriveMotiveCandidates(
  victim: Person,
  people: Person[],
  relationships: Relationship[],
): MotiveCandidate[] {
  const graph = new RelationshipGraph(relationships);
  const candidates: MotiveCandidate[] = [];

  for (const holder of people) {
    if (holder.id === victim.id) continue;
    const rel = graph.between(holder.id, victim.id);
    if (rel) {
      const direct = directMotiveFromRelationship(holder, victim, rel);
      if (direct) candidates.push(direct);
    }
    candidates.push(...affairTriangleMotives(holder, victim, graph));
  }

  return candidates.sort((a, b) => b.strength - a.strength);
}

export function pickCulprit(rng: RNG, candidates: MotiveCandidate[]): MotiveCandidate {
  if (candidates.length === 0) {
    throw new Error("No motive candidates available to select a culprit from");
  }
  const strong = candidates.filter((c) => c.strength >= 0.35);
  const pool = strong.length > 0 ? strong : candidates;
  return rng.pickWeighted(pool.map((c) => ({ item: c, weight: c.strength + 0.05 })));
}

export function toMotive(candidate: MotiveCandidate): Motive {
  return {
    type: candidate.type,
    holderId: candidate.holderId,
    targetId: candidate.targetId,
    description: candidate.description,
    strength: candidate.strength,
    groundingRelationshipIds: candidate.groundingRelationshipIds,
  };
}
