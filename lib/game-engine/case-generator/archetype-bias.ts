import type { RNG } from "../random/rng";
import type { Person, PersonId } from "../types/person";
import type { Location } from "../types/location";
import type { Relationship, RelationshipAttributes, RelationshipType } from "../types/relationship";
import type { ArchetypePolicy } from "./archetype";

function removeExistingRelationship(relationships: Relationship[], aId: PersonId, bId: PersonId): Relationship[] {
  return relationships.filter((r) => !((r.from === aId && r.to === bId) || (r.from === bId && r.to === aId)));
}

function fullAttributes(overrides: Partial<RelationshipAttributes>): RelationshipAttributes {
  return { trust: 0.4, affection: 0.3, hatred: 0, jealousy: 0, fear: 0, dependency: 0.1, debtChf: 0, ...overrides };
}

interface InjectionContext {
  rng: RNG;
  people: Person[];
  locations: Location[];
  relationships: Relationship[];
}

function inject(ctx: InjectionContext, from: Person, to: Person, type: RelationshipType, attributes: RelationshipAttributes, secret: string | null) {
  ctx.relationships = removeExistingRelationship(ctx.relationships, from.id, to.id);
  ctx.relationships.push({ id: ctx.rng.id("rel-archetype"), type, from: from.id, to: to.id, attributes, secret });
}

/** Picks two distinct people who aren't the same person, biased toward
 * whoever the population actually has (no special filtering — the point is
 * to *guarantee* the relationship exists, not to guess who "should" have
 * it). */
function pickPair(rng: RNG, people: Person[]): [Person, Person] {
  const [a, b] = rng.sample(people, 2);
  return [a, b];
}

function pickThird(rng: RNG, people: Person[], excludeIds: PersonId[]): Person | null {
  const pool = people.filter((p) => !excludeIds.includes(p.id));
  return pool.length > 0 ? rng.pick(pool) : null;
}

/** student/unemployed/retired never get an ordinary workplace (see
 * `case-generator/occupations.ts`) — the workplace_conspiracy branch below
 * force-assigns a shared `workLocationId`, so it must only ever draw from
 * people whose life status can plausibly carry one. */
function canHoldOrdinaryWorkplace(person: Person): boolean {
  return person.lifeStatus === "employed" || person.lifeStatus === "self_employed" || person.lifeStatus === "apprentice";
}

/**
 * Guarantees the relationship graph actually *supports* the chosen
 * archetype, instead of the archetype being just a label attached after the
 * fact. Each branch injects (or overwrites) one strong, deliberately
 * strength-tuned relationship whose type and attributes are exactly what
 * `deriveMotiveCandidates` (see motive.ts) needs to produce a viable,
 * strongly-weighted motive of the archetype's preferred type — which is
 * what then lets victim/culprit selection actually gravitate toward it
 * (see the archetype-aware weighting in motive.ts) rather than the
 * archetype only ever showing up as post-hoc flavor text.
 *
 * Also mutates `people` in place for the two archetypes that need a
 * structural fact beyond the relationship itself (inheritance needs a
 * wealthy family member; workplace conspiracy needs an actual shared
 * workplace) — consistent with how the rest of the pipeline already treats
 * `people` as a mutable working set (see `person.roles.push` in case-truth.ts).
 */
export function applyArchetypeStoryBias(
  rng: RNG,
  policy: ArchetypePolicy,
  people: Person[],
  locations: Location[],
  relationships: Relationship[],
): Relationship[] {
  const ctx: InjectionContext = { rng: rng.derive("archetype-bias"), people, locations, relationships: [...relationships] };

  switch (policy.id) {
    case "domestic_conflict": {
      const [a, b] = pickPair(ctx.rng, people);
      inject(
        ctx,
        a,
        b,
        ctx.rng.bool(0.5) ? "ex_partner" : "spouse",
        fullAttributes({ trust: 0.1, affection: 0.3, hatred: 0.75, jealousy: 0.65, dependency: 0.3 }),
        "rupture douloureuse, contact évité depuis",
      );
      break;
    }

    case "workplace_conspiracy": {
      // Only draw from people whose life status can hold an ordinary
      // workplace at all — falls back to the full population in the
      // (unlikely) case fewer than two people qualify, same as pickPair's
      // own "guarantee the relationship exists" philosophy.
      const eligible = people.filter(canHoldOrdinaryWorkplace);
      const pairPool = eligible.length >= 2 ? eligible : people;
      const [boss, employee] = pickPair(ctx.rng, pairPool);
      const workplace =
        ctx.locations.find((l) => l.type === "office") ?? ctx.locations.find((l) => l.type === "shop") ?? ctx.locations[0];
      if (workplace) {
        boss.workLocationId = workplace.id;
        employee.workLocationId = workplace.id;
      }
      inject(ctx, boss, employee, "boss", fullAttributes({ trust: 0.15, hatred: 0.3, fear: 0.3 }), null);
      const colleaguePool = eligible.length > 0 ? eligible : people;
      const colleague = pickThird(ctx.rng, colleaguePool, [boss.id, employee.id]);
      if (colleague && workplace) {
        colleague.workLocationId = workplace.id;
        inject(ctx, employee, colleague, "colleague", fullAttributes({ trust: 0.5, affection: 0.3 }), null);
      }
      break;
    }

    case "inheritance_dispute":
    case "staged_burglary": {
      const [wealthy, relative] = pickPair(ctx.rng, people);
      wealthy.wealthChf = Math.max(wealthy.wealthChf, Math.round(400_000 + ctx.rng.range(0, 400_000)));
      inject(ctx, wealthy, relative, "family", fullAttributes({ trust: 0.25, affection: 0.4, dependency: 0.6 }), null);
      const secondHeir = pickThird(ctx.rng, people, [wealthy.id, relative.id]);
      if (secondHeir) {
        inject(ctx, wealthy, secondHeir, "family", fullAttributes({ trust: 0.3, affection: 0.35, dependency: 0.45 }), null);
      }
      break;
    }

    case "financial_fraud_murder": {
      const [debtor, creditor] = pickPair(ctx.rng, people);
      inject(
        ctx,
        debtor,
        creditor,
        "creditor_debtor",
        fullAttributes({ trust: 0.15, fear: 0.7, hatred: 0.3, debtChf: Math.round(60_000 + ctx.rng.range(0, 60_000)) }),
        "menace de dénonciation si non remboursé",
      );
      break;
    }

    case "disappearance_to_homicide": {
      const [a, b] = pickPair(ctx.rng, people);
      inject(
        ctx,
        a,
        b,
        "affair",
        fullAttributes({ trust: 0.5, affection: 0.6, fear: 0.65 }),
        "liaison cachée à l'entourage",
      );
      break;
    }

    case "revenge_killing": {
      const [a, b] = pickPair(ctx.rng, people);
      // The "historical conflict" the archetype calls for: a high-hatred
      // rivalry carrying an explicit, long-standing grievance rather than a
      // fresh one — this is what a revenge motive is actually revenge *for*.
      inject(
        ctx,
        a,
        b,
        ctx.rng.bool(0.5) ? "rival" : "conflict",
        fullAttributes({ trust: 0.1, hatred: 0.8, jealousy: 0.3 }),
        "un conflit ancien jamais résolu, remontant à plusieurs années",
      );
      break;
    }

    case "crime_of_opportunity": {
      // Deliberately weaker and history-free — this archetype is about a
      // spontaneous flare-up between people who don't have deep history,
      // not a simmering grudge.
      const [a, b] = pickPair(ctx.rng, people);
      inject(ctx, a, b, "conflict", fullAttributes({ trust: 0.2, hatred: 0.45 }), null);
      break;
    }

    default:
      break;
  }

  return ctx.relationships;
}
