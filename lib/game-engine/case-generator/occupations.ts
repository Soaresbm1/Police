import type { RNG } from "../random/rng";
import type { LifeStatus } from "../types/person";
import type { LocationType } from "../types/location";

/**
 * Data-driven occupation metadata: every occupation is realistically bounded
 * by the minimum age at which it's plausible to hold it and by which
 * `LifeStatus` values it's compatible with (e.g. a judge is never an
 * "apprentice", a mechanic can be). `selectionWeight` is a relative weight
 * among the occupations compatible with a given age/status, not a
 * probability of the occupation existing at all — see `resolveOccupation`.
 *
 * Vironval is a fictional European town; ages here are broadly plausible
 * European education/career minimums, not a claim about any specific
 * country's legal working age.
 */
export interface OccupationMeta {
  id: string;
  minAge: number;
  /** Only set where a hard ceiling is genuinely justified; absent means "no
   * upper bound beyond what `LifeStatus` age-weighting already makes rare". */
  maxAge?: number;
  allowedStatuses: LifeStatus[];
  /** Preferred workplace location type, if any — see `pickWorkplace` in
   * `population.ts`. Occupations without one fall back to a generic
   * office/shop assignment. */
  locationType?: LocationType;
  /** Relative weight among occupations compatible with a given age+status
   * (not an absolute probability): higher = more common. */
  selectionWeight: number;
}

export const OCCUPATIONS: OccupationMeta[] = [
  { id: "comptable", minAge: 21, allowedStatuses: ["employed", "self_employed"], selectionWeight: 3 },
  { id: "infirmier·ère", minAge: 21, allowedStatuses: ["employed"], locationType: "hospital", selectionWeight: 3 },
  { id: "enseignant·e", minAge: 23, allowedStatuses: ["employed"], selectionWeight: 3 },
  { id: "mécanicien·ne", minAge: 17, allowedStatuses: ["apprentice", "employed", "self_employed"], selectionWeight: 3 },
  { id: "avocat·e", minAge: 26, allowedStatuses: ["employed", "self_employed"], selectionWeight: 1.5 },
  { id: "serveur·se", minAge: 16, allowedStatuses: ["employed"], locationType: "restaurant", selectionWeight: 4 },
  { id: "policier", minAge: 20, allowedStatuses: ["employed"], locationType: "police_station", selectionWeight: 2 },
  { id: "architecte", minAge: 25, allowedStatuses: ["employed", "self_employed"], selectionWeight: 1.5 },
  { id: "gérant·e de commerce", minAge: 22, allowedStatuses: ["employed", "self_employed"], locationType: "shop", selectionWeight: 2 },
  { id: "chauffeur·se de taxi", minAge: 21, allowedStatuses: ["employed", "self_employed"], selectionWeight: 2 },
  { id: "informaticien·ne", minAge: 19, allowedStatuses: ["employed", "self_employed"], selectionWeight: 3 },
  { id: "médecin", minAge: 27, allowedStatuses: ["employed", "self_employed"], locationType: "hospital", selectionWeight: 1 },
  { id: "employé·e de banque", minAge: 19, allowedStatuses: ["employed"], locationType: "bank", selectionWeight: 2 },
  { id: "artisan·e", minAge: 17, allowedStatuses: ["apprentice", "employed", "self_employed"], selectionWeight: 3 },
  { id: "agent immobilier", minAge: 21, allowedStatuses: ["employed", "self_employed"], selectionWeight: 2 },
  { id: "journaliste", minAge: 20, allowedStatuses: ["employed", "self_employed"], selectionWeight: 2 },
  { id: "barman/barmaid", minAge: 18, allowedStatuses: ["employed"], locationType: "bar", selectionWeight: 2 },
  // Higher-education / higher-seniority roles — the explicit motivating
  // examples for this system (a 22-year-old judge, a 20-year-old doctor).
  { id: "juge", minAge: 35, allowedStatuses: ["employed"], selectionWeight: 0.5 },
  { id: "ingénieur·e", minAge: 22, allowedStatuses: ["employed", "self_employed"], selectionWeight: 2.5 },
  { id: "directeur·rice", minAge: 30, allowedStatuses: ["employed"], selectionWeight: 1 },
];

const OCCUPATIONS_BY_ID = new Map(OCCUPATIONS.map((o) => [o.id, o]));

export function occupationLocationType(occupationId: string): LocationType | undefined {
  return OCCUPATIONS_BY_ID.get(occupationId)?.locationType;
}

function compatiblePool(status: LifeStatus, age: number): OccupationMeta[] {
  return OCCUPATIONS.filter(
    (o) => o.allowedStatuses.includes(status) && age >= o.minAge && (o.maxAge === undefined || age <= o.maxAge),
  );
}

export interface ResolvedOccupation {
  status: LifeStatus;
  /** null for student/unemployed/retired, and for apprentice/employed/
   * self_employed always a valid `OccupationMeta.id`. */
  occupation: string | null;
}

/**
 * Turns a candidate `LifeStatus` into a concrete, age-compatible occupation
 * (or none, for statuses that don't carry one). Deterministic, single-pass,
 * no reroll loop: if the candidate status has zero compatible occupations at
 * this age (a theoretical edge case given the occupation minAges chosen —
 * the youngest is 16, matching the population's own age floor), it falls
 * back once to the `employed` pool at that age, and if even that is empty,
 * resolves to `unemployed`.
 */
export function resolveOccupation(rng: RNG, age: number, status: LifeStatus): ResolvedOccupation {
  if (status === "student" || status === "retired" || status === "unemployed") {
    return { status, occupation: null };
  }

  const pool = compatiblePool(status, age);
  if (pool.length > 0) {
    return { status, occupation: rng.pickWeighted(pool.map((o) => ({ item: o.id, weight: o.selectionWeight }))) };
  }

  const employedFallback = compatiblePool("employed", age);
  if (employedFallback.length > 0) {
    return {
      status: "employed",
      occupation: rng.pickWeighted(employedFallback.map((o) => ({ item: o.id, weight: o.selectionWeight }))),
    };
  }

  return { status: "unemployed", occupation: null };
}

/** Fixed display labels for the statuses that don't carry an occupation. */
const STATUS_LABELS: Record<"student" | "unemployed" | "retired", string> = {
  student: "étudiant·e",
  unemployed: "chômeur·se",
  retired: "retraité·e",
};

/** The `Person.profession` display string for a resolved status+occupation. */
export function professionLabel(resolved: ResolvedOccupation): string {
  const { status, occupation } = resolved;
  if (status === "student" || status === "unemployed" || status === "retired") {
    return STATUS_LABELS[status];
  }
  // apprentice/employed/self_employed always carry an occupation, by
  // resolveOccupation's contract.
  if (status === "apprentice") return `apprenti·e ${occupation}`;
  return occupation as string;
}
