import type { RNG } from "../random/rng";
import type { Person, PersonId } from "../types/person";
import type { Relationship } from "../types/relationship";
import { RelationshipGraph } from "../types/relationship";
import type { Evidence, EvidenceType } from "../types/evidence";
import type { SharedResource, SharedResourceKind } from "../types/shared-resource";

const SHARABLE_RELATIONSHIP_TYPES = ["spouse", "partner", "family", "boss", "employee"] as const;

/**
 * Rolls a handful of genuinely shared devices/accounts among closely
 * related people — a family bank account, a company car, a home Wi-Fi both
 * partners use. Kept deliberately sparse: most relationships share nothing,
 * so ambiguity stays the exception, not the norm.
 */
export function generateSharedResources(rng: RNG, people: Person[], relationships: Relationship[]): SharedResource[] {
  const graph = new RelationshipGraph(relationships);
  const seenPairs = new Set<string>();
  const resources: SharedResource[] = [];

  for (const rel of relationships) {
    if (!(SHARABLE_RELATIONSHIP_TYPES as readonly string[]).includes(rel.type)) continue;
    const pairKey = [rel.from, rel.to].sort().join("|");
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);

    const a = people.find((p) => p.id === rel.from);
    const b = people.find((p) => p.id === rel.to);
    if (!a || !b) continue;

    const resourceRng = rng.derive(`shared-${pairKey}`);
    if (!resourceRng.bool(0.12)) continue;

    const candidateKinds: SharedResourceKind[] = [];
    if (a.vehicle || b.vehicle) candidateKinds.push("vehicle");
    if (rel.type === "spouse" || rel.type === "partner" || rel.type === "family") {
      candidateKinds.push("wifi", "bank_account");
    }
    if (rel.type === "boss" || rel.type === "employee") candidateKinds.push("phone");
    if (candidateKinds.length === 0) continue;

    const kind = resourceRng.pick(candidateKinds);
    resources.push({
      id: resourceRng.id("shr"),
      kind,
      ownerPersonIds: [a.id, b.id],
      label: LABEL[kind](a, b),
    });
  }

  void graph;
  return resources;
}

const LABEL: Record<SharedResourceKind, (a: Person, b: Person) => string> = {
  phone: (a, b) => `Ligne professionnelle partagée entre ${a.firstName} ${a.lastName} et ${b.firstName} ${b.lastName}`,
  vehicle: (a, b) => `Véhicule utilisé indifféremment par ${a.firstName} ${a.lastName} et ${b.firstName} ${b.lastName}`,
  wifi: (a, b) => `Réseau Wi-Fi domestique partagé par ${a.firstName} ${a.lastName} et ${b.firstName} ${b.lastName}`,
  bank_account: (a, b) => `Compte bancaire familial partagé entre ${a.firstName} ${a.lastName} et ${b.firstName} ${b.lastName}`,
};

const PHONE_LINKED_TYPES: EvidenceType[] = ["call_log", "sms_log", "geolocation_log", "wifi_connection_log"];
const ACCOUNT_LINKED_TYPES: EvidenceType[] = ["bank_transfer", "cash_withdrawal", "card_payment"];

/**
 * Widens `relatedPersonIds` on evidence tied to a shared resource so every
 * co-owner is listed, not just whoever actually triggered the event —
 * exactly the ambiguity a shared phone or account should create. Evidence
 * unrelated to any shared resource is untouched.
 */
function buildOwnerIndex(resources: SharedResource[], kinds: SharedResourceKind[]): Map<PersonId, Set<PersonId>[]> {
  const index = new Map<PersonId, Set<PersonId>[]>();
  for (const res of resources) {
    if (!kinds.includes(res.kind)) continue;
    for (const owner of res.ownerPersonIds) {
      const list = index.get(owner) ?? [];
      list.push(new Set(res.ownerPersonIds));
      index.set(owner, list);
    }
  }
  return index;
}

export function applySharedResourceAmbiguity(evidence: Evidence[], resources: SharedResource[]): Evidence[] {
  if (resources.length === 0) return evidence;
  // Segregated by kind: a shared bank account must never widen a
  // geolocation ping, and a shared phone/Wi-Fi must never widen a bank
  // transaction — each evidence family only cares about the one resource
  // kind that could plausibly produce it.
  const deviceOwners = buildOwnerIndex(resources, ["phone", "wifi"]);
  const accountOwners = buildOwnerIndex(resources, ["bank_account"]);
  if (deviceOwners.size === 0 && accountOwners.size === 0) return evidence;

  const widen = (ev: Evidence, index: Map<PersonId, Set<PersonId>[]>): Evidence => {
    // Only widen evidence that's *solely* attributed to one person so far —
    // one who happens to co-own a shared resource. Evidence that already
    // names someone else for an unrelated reason (e.g. a dinner companion
    // on a card payment) is left untouched: folding in another, unrelated
    // co-owner would produce an incoherent multi-person entry, not genuine
    // ambiguity.
    if (ev.relatedPersonIds.length !== 1) return ev;
    const groups = index.get(ev.relatedPersonIds[0]);
    if (!groups || groups.length === 0) return ev;
    // Only the first matching resource — a person who happens to co-own two
    // *different* shared resources with two different people should never
    // fold both into one evidence entry; that's two separate ambiguities,
    // not one three-way one.
    return { ...ev, relatedPersonIds: [...groups[0]] };
  };

  return evidence.map((ev) => {
    if (PHONE_LINKED_TYPES.includes(ev.type)) return widen(ev, deviceOwners);
    if (ACCOUNT_LINKED_TYPES.includes(ev.type)) return widen(ev, accountOwners);
    return ev;
  });
}
