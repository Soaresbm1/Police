import type { PersonId } from "./person";

export type RelationshipType =
  | "family"
  | "spouse"
  | "partner"
  | "ex_partner"
  | "friend"
  | "colleague"
  | "boss"
  | "employee"
  | "rival"
  | "creditor_debtor"
  | "affair"
  | "conflict"
  | "neighbor"
  | "acquaintance";

/**
 * All attributes are normalized to [0, 1] except `debtChf`. The relationship
 * is stored once, directed from `from` to `to`; attributes describe how
 * `from` feels about / relates to `to` (e.g. `from` owes `to` money when
 * type is "creditor_debtor" and debtChf > 0).
 */
export interface RelationshipAttributes {
  trust: number;
  affection: number;
  hatred: number;
  jealousy: number;
  fear: number;
  dependency: number;
  debtChf: number;
}

export interface Relationship {
  id: string;
  type: RelationshipType;
  from: PersonId;
  to: PersonId;
  attributes: RelationshipAttributes;
  /** e.g. "affair hidden from spouse", "gambling debt not disclosed to family" */
  secret: string | null;
}

export class RelationshipGraph {
  private readonly byPerson = new Map<PersonId, Relationship[]>();
  readonly all: Relationship[];

  constructor(relationships: Relationship[]) {
    this.all = relationships;
    for (const rel of relationships) {
      this.push(rel.from, rel);
      this.push(rel.to, rel);
    }
  }

  private push(personId: PersonId, rel: Relationship) {
    const list = this.byPerson.get(personId) ?? [];
    list.push(rel);
    this.byPerson.set(personId, list);
  }

  /** All relationships touching this person, in either direction. */
  of(personId: PersonId): Relationship[] {
    return this.byPerson.get(personId) ?? [];
  }

  /** The relationship directed from `a` to `b`, if any (order matters for asymmetric attributes). */
  between(a: PersonId, b: PersonId): Relationship | undefined {
    return this.all.find(
      (r) => (r.from === a && r.to === b) || (r.from === b && r.to === a),
    );
  }

  areConnected(a: PersonId, b: PersonId): boolean {
    return this.between(a, b) !== undefined;
  }
}
