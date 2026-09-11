import type { Person, PersonId } from "./person";
import type { Location, LocationId } from "./location";
import type { Relationship } from "./relationship";
import type { TimelineEvent } from "./timeline";
import type { Evidence, TamperingEvent } from "./evidence";
import type { KnowledgeFact, TestimonyLine } from "./knowledge";
import type { GameMinutes } from "./time";
import type { SharedResource } from "./shared-resource";

export type CaseSeed = string;

export type CrimeType = "homicide";

export type Difficulty = "recruit" | "investigator" | "inspector" | "expert";

export type CrimeMethod = "blunt_force" | "stabbing" | "poisoning" | "strangulation" | "firearm" | "fall_push" | "staged_overdose";

export type CaseArchetype =
  | "domestic_conflict"
  | "workplace_conspiracy"
  | "inheritance_dispute"
  | "financial_fraud_murder"
  | "disappearance_to_homicide"
  | "staged_burglary"
  | "revenge_killing"
  | "crime_of_opportunity";

export type StagingType = "none" | "burglary" | "suicide" | "accident" | "robbery_gone_wrong";

export interface StagingInfo {
  type: StagingType;
  staged: boolean;
  /** Evidence ids that logically reveal the staging as false — always
   * populated when `staged` is true (see the validator's checkStaging). */
  tellEvidenceIds: string[];
  description: string;
}

export type AccompliceRole = "planner" | "lookout" | "driver" | "evidence_disposal" | "false_alibi_provider";

export interface Accomplice {
  personId: PersonId;
  role: AccompliceRole;
  /** A lookout or driver typically knows only their own slice of the plan;
   * a planner always knows everything. This gates what they can be asked
   * about truthfully versus what they'd have to lie or plead ignorance on. */
  knowsFullPlan: boolean;
  involvementDescription: string;
}

export type FalseConfessionReason = "protecting_someone" | "fear" | "coercion_pressure" | "guilt_for_another_secret";

/**
 * A full, self-contradicting statement — not just a flag. `claimedTiming` is
 * deliberately wrong relative to the autopsy's death window (visible to the
 * player from the very start of the case, on the dossier), so a careful
 * player always has an always-available way to catch the lie without
 * needing to discover anything else first.
 */
export interface FalseConfession {
  personId: PersonId;
  reason: FalseConfessionReason;
  /** Who they're shielding, when the reason is protecting_someone. */
  protectedPersonId: PersonId | null;
  explanation: string;
  /** What they claim to have done, in their own words — a full account, not
   * just a guilty plea. */
  claimedReconstruction: string;
  /** May or may not match the true method — when it does, it's because the
   * cause of death is public knowledge (from the discovery report), not
   * because the confessor actually knows more than that. */
  claimedMethod: string;
  claimedTimingStart: GameMinutes;
  claimedTimingEnd: GameMinutes;
  claimedMotiveText: string;
  /** Plain-language statement of the one detail that objectively conflicts
   * with the evidence — always populated, always about `claimedTiming`
   * vs. the autopsy window (see validator checkFalseConfession). */
  conflictingDetail: string;
  /** Evidence ids the player can use to disprove the confession — always
   * non-empty (see the validator's checkFalseConfession). */
  disprovingEvidenceIds: string[];
}

export type MotiveType =
  | "jealousy"
  | "revenge"
  | "money"
  | "inheritance"
  | "debt"
  | "blackmail"
  | "secret_exposure"
  | "crime_passionnel"
  | "professional_conflict"
  | "fraud"
  | "fear_of_denunciation"
  | "rivalry"
  | "protect_a_loved_one"
  | "staged_accident";

export interface Motive {
  type: MotiveType;
  holderId: PersonId;
  targetId: PersonId;
  description: string;
  /** 0-1, derived from the relationship graph, not chosen freely. */
  strength: number;
  groundingRelationshipIds: string[];
}

export interface Alibi {
  personId: PersonId;
  /** What the person claims, whether or not it's true. */
  claim: string;
  isTrue: boolean;
  windowStart: GameMinutes;
  windowEnd: GameMinutes;
  claimedLocationId: LocationId;
  /** Evidence ids that would corroborate this alibi if a player finds them. */
  corroboratingEvidenceIds: string[];
  /** Evidence ids that would contradict/break this alibi if a player finds them. */
  contradictingEvidenceIds: string[];
}

export interface AutopsyReport {
  estimatedDeathWindowStart: GameMinutes;
  estimatedDeathWindowEnd: GameMinutes;
  causeOfDeath: string;
  weaponType: string;
  wounds: string[];
  substancesFound: string[];
  bodyPosition: string;
  notableFeatures: string[];
}

export interface CaseTruth {
  seed: CaseSeed;
  difficulty: Difficulty;
  crimeType: CrimeType;
  archetype: CaseArchetype;
  generatedAt: string;

  locations: Location[];
  people: Person[];
  relationships: Relationship[];

  victimId: PersonId;
  culpritId: PersonId;
  accompliceIds: PersonId[];
  accomplices: Accomplice[];
  suspectIds: PersonId[];

  motive: Motive;
  /** Other credible motives in play, including secondary motives the
   * culprit themself might have — keyed by holder id. Never used to
   * identify the culprit on its own (see validator + solvability rules). */
  suspectMotives: Record<PersonId, Motive[]>;
  method: string;
  methodType: CrimeMethod;
  weapon: string;
  crimeLocationId: LocationId;
  crimeTimestamp: GameMinutes;
  premeditated: boolean;
  staging: StagingInfo;
  falseConfession: FalseConfession | null;
  tamperingEvents: TamperingEvent[];
  sharedResources: SharedResource[];

  timeline: TimelineEvent[];
  evidence: Evidence[];
  knowledge: KnowledgeFact[];
  testimony: TestimonyLine[];
  alibis: Alibi[];
  autopsy: AutopsyReport;

  redHerringPersonIds: PersonId[];

  /**
   * The exact moment the case opened (body discovered) — the same value
   * threaded into `generatePostCrimeMovements` at generation time (see
   * `case-generator/case-truth.ts`), surfaced here so callers (Phase 5B
   * surveillance) can compute `postCrimeMovements`' true coverage window
   * (`[caseOpenedAt, caseOpenedAt + 48h)`) without re-deriving it. Purely
   * an exposure of already-computed data — never recomputed, never
   * approximated (unlike `CaseBriefing.reportedAt`, a deliberately fuzzed
   * pre-game estimate).
   */
  caseOpenedAt: GameMinutes;

  /**
   * Living Investigation System Phase 5A — a small, separate, immutable
   * layer of ordinary post-crime routine activity (wake/work/sleep only),
   * generated once at case-generation time for every non-victim person,
   * covering exactly the 48 hours starting at the moment the case opens
   * (`[caseOpenedAt, caseOpenedAt + 48h)`, never the following midnight).
   * It exists solely so a future surveillance mechanic (Phase 5B, not yet
   * built) has real, pre-existing activity to observe once investigation
   * is underway.
   *
   * Deliberately isolated from everything else in this interface: never
   * read by evidence derivation, the knowledge graph, testimony, alibis,
   * red herrings, the validator, or `computeSolvability` — see
   * `simulation/post-crime-observation.ts`. Uses its own domain-separated
   * RNG stream, so its mere existence changes nothing else generated from
   * the same seed.
   */
  postCrimeMovements: TimelineEvent[];
}

/** What the player is allowed to see before starting the investigation.
 * CaseTruth itself must never cross the server boundary. */
export interface CaseBriefing {
  seed: CaseSeed;
  difficulty: Difficulty;
  crimeType: CrimeType;
  victimName: string;
  victimAge: number;
  discoveryLocationName: string;
  discoveryDescription: string;
  reportedAt: GameMinutes;
  suspectCount: number;
  witnessCount: number;
}

export function toCaseBriefing(truth: CaseTruth): CaseBriefing {
  const victim = truth.people.find((p) => p.id === truth.victimId);
  if (!victim) throw new Error("CaseTruth is missing its victim record");
  const location = truth.locations.find((l) => l.id === truth.crimeLocationId);
  return {
    seed: truth.seed,
    difficulty: truth.difficulty,
    crimeType: truth.crimeType,
    victimName: `${victim.firstName} ${victim.lastName}`,
    victimAge: victim.age,
    discoveryLocationName: location?.name ?? "Lieu inconnu",
    discoveryDescription: `Le corps de ${victim.firstName} ${victim.lastName} a été découvert.`,
    reportedAt: truth.crimeTimestamp + 60,
    suspectCount: truth.suspectIds.length,
    witnessCount: truth.people.length - truth.suspectIds.length - 1,
  };
}
