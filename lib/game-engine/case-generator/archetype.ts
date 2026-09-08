import type { RNG } from "../random/rng";
import type { CaseArchetype, Difficulty, MotiveType, StagingType } from "../types/case";
import type { CrimeMethod } from "../types/case";
import type { RelationshipType } from "../types/relationship";

/**
 * The structural "spine" of a case: a data-driven policy that biases every
 * later generation step (motive selection, method, staging odds, accomplice
 * odds, which relationships matter) toward one coherent story shape, instead
 * of every case being the same template with different names rolled in.
 */
export interface ArchetypePolicy {
  id: CaseArchetype;
  label: string;
  motiveWeights: Partial<Record<MotiveType, number>>;
  methodWeights: Partial<Record<CrimeMethod, number>>;
  stagingWeights: Partial<Record<StagingType, number>>;
  preferredRelationshipTypes: RelationshipType[];
  accompliceChanceMultiplier: number;
  tamperingChanceMultiplier: number;
  /** Minimum difficulty this archetype is allowed to appear at — keeps
   * Recruit cases structurally simpler than Expert ones. */
  minDifficulty: Difficulty;
}

const DIFFICULTY_RANK: Record<Difficulty, number> = { recruit: 0, investigator: 1, inspector: 2, expert: 3 };

export const ARCHETYPE_POLICIES: Record<CaseArchetype, ArchetypePolicy> = {
  domestic_conflict: {
    id: "domestic_conflict",
    label: "Conflit domestique",
    motiveWeights: { jealousy: 3, crime_passionnel: 3, revenge: 2 },
    methodWeights: { stabbing: 3, blunt_force: 2, strangulation: 2 },
    stagingWeights: { none: 5, accident: 1 },
    preferredRelationshipTypes: ["spouse", "partner", "ex_partner"],
    accompliceChanceMultiplier: 0.4,
    tamperingChanceMultiplier: 0.8,
    minDifficulty: "recruit",
  },
  workplace_conspiracy: {
    id: "workplace_conspiracy",
    label: "Conspiration professionnelle",
    motiveWeights: { professional_conflict: 3, fraud: 2, fear_of_denunciation: 2 },
    methodWeights: { poisoning: 2, blunt_force: 2, staged_overdose: 1 },
    stagingWeights: { none: 3, accident: 2 },
    preferredRelationshipTypes: ["boss", "employee", "colleague"],
    accompliceChanceMultiplier: 1.4,
    tamperingChanceMultiplier: 1.3,
    minDifficulty: "investigator",
  },
  inheritance_dispute: {
    id: "inheritance_dispute",
    label: "Différend successoral",
    motiveWeights: { inheritance: 4, money: 1 },
    methodWeights: { poisoning: 2, fall_push: 2, staged_overdose: 1 },
    stagingWeights: { accident: 3, none: 2 },
    preferredRelationshipTypes: ["family"],
    accompliceChanceMultiplier: 1.0,
    tamperingChanceMultiplier: 1.0,
    minDifficulty: "recruit",
  },
  financial_fraud_murder: {
    id: "financial_fraud_murder",
    label: "Fraude financière ayant dégénéré",
    motiveWeights: { fraud: 3, fear_of_denunciation: 3, blackmail: 2, debt: 1 },
    methodWeights: { blunt_force: 1, firearm: 2, staged_overdose: 2 },
    stagingWeights: { robbery_gone_wrong: 2, none: 2 },
    preferredRelationshipTypes: ["creditor_debtor", "colleague", "boss"],
    accompliceChanceMultiplier: 1.6,
    tamperingChanceMultiplier: 1.6,
    minDifficulty: "inspector",
  },
  disappearance_to_homicide: {
    id: "disappearance_to_homicide",
    label: "Disparition devenue homicide",
    motiveWeights: { secret_exposure: 2, fear_of_denunciation: 2, revenge: 2 },
    methodWeights: { strangulation: 2, staged_overdose: 2, blunt_force: 1 },
    stagingWeights: { accident: 2, suicide: 2, none: 1 },
    preferredRelationshipTypes: ["affair", "ex_partner", "family"],
    accompliceChanceMultiplier: 1.2,
    tamperingChanceMultiplier: 1.8,
    minDifficulty: "inspector",
  },
  staged_burglary: {
    id: "staged_burglary",
    label: "Cambriolage maquillé",
    motiveWeights: { money: 2, inheritance: 2, revenge: 1 },
    methodWeights: { blunt_force: 2, stabbing: 2, firearm: 1 },
    stagingWeights: { burglary: 5, robbery_gone_wrong: 2 },
    preferredRelationshipTypes: ["family", "spouse", "rival"],
    accompliceChanceMultiplier: 1.3,
    tamperingChanceMultiplier: 1.2,
    minDifficulty: "investigator",
  },
  revenge_killing: {
    id: "revenge_killing",
    label: "Règlement de comptes",
    motiveWeights: { revenge: 4, rivalry: 2, jealousy: 1 },
    methodWeights: { stabbing: 2, firearm: 2, blunt_force: 1 },
    stagingWeights: { none: 5, robbery_gone_wrong: 1 },
    preferredRelationshipTypes: ["rival", "conflict", "ex_partner"],
    accompliceChanceMultiplier: 1.1,
    tamperingChanceMultiplier: 0.9,
    minDifficulty: "recruit",
  },
  crime_of_opportunity: {
    id: "crime_of_opportunity",
    label: "Crime d'opportunité",
    motiveWeights: { rivalry: 2, jealousy: 2, money: 1 },
    methodWeights: { blunt_force: 3, stabbing: 2 },
    stagingWeights: { none: 6 },
    preferredRelationshipTypes: ["acquaintance", "neighbor", "conflict"],
    accompliceChanceMultiplier: 0.2,
    tamperingChanceMultiplier: 0.3,
    minDifficulty: "recruit",
  },
};

export function pickArchetype(rng: RNG, difficulty: Difficulty): ArchetypePolicy {
  const rank = DIFFICULTY_RANK[difficulty];
  const eligible = Object.values(ARCHETYPE_POLICIES).filter((a) => DIFFICULTY_RANK[a.minDifficulty] <= rank);
  const pool = eligible.length > 0 ? eligible : Object.values(ARCHETYPE_POLICIES);
  return rng.pick(pool);
}

/** Re-weights a set of scored candidates using the archetype's motive
 * preferences — a soft bias, never a hard filter, so a case can never fail
 * to generate purely because the population didn't happen to produce the
 * archetype's favorite motive. */
export function archetypeMotiveBoost(policy: ArchetypePolicy, motiveType: MotiveType): number {
  return policy.motiveWeights[motiveType] ?? 1;
}
