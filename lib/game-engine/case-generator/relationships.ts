import type { RNG } from "../random/rng";
import type { Person, PersonId } from "../types/person";
import type { Location } from "../types/location";
import { distanceKm } from "../types/location";
import type { Relationship, RelationshipAttributes, RelationshipType } from "../types/relationship";

function pairKey(a: PersonId, b: PersonId): string {
  return [a, b].sort().join("|");
}

function baseAttributes(rng: RNG, overrides: Partial<RelationshipAttributes> = {}): RelationshipAttributes {
  return {
    trust: rng.range(0.2, 0.7),
    affection: rng.range(0.1, 0.6),
    hatred: rng.range(0, 0.2),
    jealousy: rng.range(0, 0.2),
    fear: rng.range(0, 0.2),
    dependency: rng.range(0, 0.3),
    debtChf: 0,
    ...overrides,
  };
}

interface Builder {
  people: Person[];
  locations: Map<string, Location>;
  relationships: Relationship[];
  usedPairs: Set<string>;
  rng: RNG;
}

function add(b: Builder, from: Person, to: Person, type: RelationshipType, attributes: RelationshipAttributes, secret: string | null = null) {
  const key = pairKey(from.id, to.id);
  if (from.id === to.id || b.usedPairs.has(key)) return;
  b.relationships.push({
    id: b.rng.id("rel"),
    type,
    from: from.id,
    to: to.id,
    attributes,
    secret,
  });
  b.usedPairs.add(key);
}

function has(b: Builder, a: Person, c: Person): boolean {
  return b.usedPairs.has(pairKey(a.id, c.id));
}

function buildFamilyClusters(b: Builder) {
  const rng = b.rng.derive("family");
  const pool = rng.shuffle(b.people);
  let i = 0;
  while (i < pool.length) {
    if (!rng.bool(0.55)) {
      i += 1;
      continue;
    }
    const clusterSize = rng.int(2, Math.min(3, pool.length - i));
    const cluster = pool.slice(i, i + clusterSize);
    i += clusterSize;
    if (cluster.length < 2) continue;

    const makeCouple = cluster.length === 2 && rng.bool(0.5);
    for (let x = 0; x < cluster.length; x++) {
      for (let y = x + 1; y < cluster.length; y++) {
        const personA = cluster[x];
        const personB = cluster[y];
        if (makeCouple) {
          add(
            b,
            personA,
            personB,
            rng.bool(0.6) ? "spouse" : "partner",
            baseAttributes(rng, {
              trust: rng.range(0.4, 0.9),
              affection: rng.range(0.3, 0.9),
              dependency: rng.range(0.3, 0.8),
            }),
          );
        } else {
          add(
            b,
            personA,
            personB,
            "family",
            baseAttributes(rng, { trust: rng.range(0.3, 0.8), affection: rng.range(0.2, 0.8) }),
          );
        }
      }
    }
  }
}

function buildExPartners(b: Builder) {
  const rng = b.rng.derive("ex-partners");
  const candidates = rng.shuffle(b.people);
  const pairCount = Math.max(1, Math.floor(candidates.length / 6));
  for (let n = 0; n < pairCount; n++) {
    const personA = candidates[n * 2];
    const personB = candidates[n * 2 + 1];
    if (!personA || !personB || has(b, personA, personB)) continue;
    add(
      b,
      personA,
      personB,
      "ex_partner",
      baseAttributes(rng, {
        trust: rng.range(0, 0.3),
        hatred: rng.range(0.2, 0.8),
        jealousy: rng.range(0.2, 0.8),
        affection: rng.range(0, 0.4),
      }),
      rng.bool(0.4) ? "rupture douloureuse, contact évité depuis" : null,
    );
  }
}

function buildAffairs(b: Builder) {
  const rng = b.rng.derive("affairs");
  const candidates = rng.shuffle(b.people);
  const pairCount = Math.max(1, Math.floor(candidates.length / 8));
  for (let n = 0; n < pairCount; n++) {
    const personA = candidates[n * 2];
    const personB = candidates[n * 2 + 1];
    if (!personA || !personB || has(b, personA, personB)) continue;
    add(
      b,
      personA,
      personB,
      "affair",
      baseAttributes(rng, {
        trust: rng.range(0.3, 0.8),
        affection: rng.range(0.4, 0.9),
        fear: rng.range(0.3, 0.8),
      }),
      "liaison cachée à l'entourage",
    );
  }
}

function buildColleagues(b: Builder) {
  const rng = b.rng.derive("colleagues");
  const byWorkplace = new Map<string, Person[]>();
  for (const person of b.people) {
    if (!person.workLocationId) continue;
    const list = byWorkplace.get(person.workLocationId) ?? [];
    list.push(person);
    byWorkplace.set(person.workLocationId, list);
  }
  for (const group of byWorkplace.values()) {
    if (group.length < 2) continue;
    const bossIndex = rng.bool(0.5) ? rng.int(0, group.length - 1) : -1;
    for (let x = 0; x < group.length; x++) {
      for (let y = x + 1; y < group.length; y++) {
        const personA = group[x];
        const personB = group[y];
        if (has(b, personA, personB)) continue;
        const isBossPair = bossIndex === x || bossIndex === y;
        if (isBossPair) {
          const boss = bossIndex === x ? personA : personB;
          const employee = boss === personA ? personB : personA;
          add(
            b,
            boss,
            employee,
            "boss",
            baseAttributes(rng, { trust: rng.range(0.1, 0.6) }),
          );
        } else {
          add(
            b,
            personA,
            personB,
            rng.bool(0.7) ? "colleague" : "rival",
            baseAttributes(rng, { hatred: rng.bool(0.3) ? rng.range(0.3, 0.7) : rng.range(0, 0.2) }),
          );
        }
      }
    }
  }
}

function buildNeighbors(b: Builder) {
  const rng = b.rng.derive("neighbors");
  const homeById = new Map(b.people.map((p) => [p.id, b.locations.get(p.homeLocationId)]));
  for (let x = 0; x < b.people.length; x++) {
    for (let y = x + 1; y < b.people.length; y++) {
      const personA = b.people[x];
      const personB = b.people[y];
      if (has(b, personA, personB)) continue;
      const homeA = homeById.get(personA.id);
      const homeB = homeById.get(personB.id);
      if (!homeA || !homeB) continue;
      if (distanceKm(homeA.coordinates, homeB.coordinates) < 0.3 && rng.bool(0.5)) {
        add(b, personA, personB, "neighbor", baseAttributes(rng));
      }
    }
  }
}

function buildDebts(b: Builder) {
  const rng = b.rng.derive("debts");
  const candidates = rng.shuffle(b.people);
  const pairCount = Math.max(1, Math.floor(candidates.length / 7));
  for (let n = 0; n < pairCount; n++) {
    const debtor = candidates[n * 2];
    const creditor = candidates[n * 2 + 1];
    if (!debtor || !creditor || has(b, debtor, creditor)) continue;
    const amount = Math.round(rng.range(3_000, 90_000) / 500) * 500;
    add(
      b,
      debtor,
      creditor,
      "creditor_debtor",
      baseAttributes(rng, {
        fear: rng.range(0.3, 0.9),
        trust: rng.range(0, 0.4),
        debtChf: amount,
      }),
      rng.bool(0.5) ? "menace de dénonciation si non remboursé" : null,
    );
  }
}

function buildFriendsAndAcquaintances(b: Builder) {
  const rng = b.rng.derive("friends");
  for (let x = 0; x < b.people.length; x++) {
    for (let y = x + 1; y < b.people.length; y++) {
      const personA = b.people[x];
      const personB = b.people[y];
      if (has(b, personA, personB)) continue;
      const sociability = (personA.personality.sociability + personB.personality.sociability) / 2;
      if (rng.bool(0.06 + sociability * 0.1)) {
        add(b, personA, personB, "friend", baseAttributes(rng, { trust: rng.range(0.4, 0.9), affection: rng.range(0.3, 0.8) }));
      } else if (rng.bool(0.08)) {
        add(b, personA, personB, "acquaintance", baseAttributes(rng, { trust: rng.range(0.1, 0.4) }));
      }
    }
  }
}

export function generateRelationships(rng: RNG, people: Person[], locations: Location[]): Relationship[] {
  const builder: Builder = {
    people,
    locations: new Map(locations.map((l) => [l.id, l])),
    relationships: [],
    usedPairs: new Set(),
    rng,
  };

  buildFamilyClusters(builder);
  buildExPartners(builder);
  buildAffairs(builder);
  buildColleagues(builder);
  buildDebts(builder);
  buildNeighbors(builder);
  buildFriendsAndAcquaintances(builder);

  return builder.relationships;
}
