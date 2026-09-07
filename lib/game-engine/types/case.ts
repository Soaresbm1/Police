import type { Person, PersonId } from "./person";
import type { Location, LocationId } from "./location";
import type { Relationship } from "./relationship";
import type { TimelineEvent } from "./timeline";
import type { Evidence } from "./evidence";
import type { KnowledgeFact, TestimonyLine } from "./knowledge";
import type { GameMinutes } from "./time";

export type CaseSeed = string;

export type CrimeType = "homicide";

export type Difficulty = "recruit" | "investigator" | "inspector" | "expert";

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
  generatedAt: string;

  locations: Location[];
  people: Person[];
  relationships: Relationship[];

  victimId: PersonId;
  culpritId: PersonId;
  accompliceIds: PersonId[];
  suspectIds: PersonId[];

  motive: Motive;
  method: string;
  weapon: string;
  crimeLocationId: LocationId;
  crimeTimestamp: GameMinutes;
  premeditated: boolean;

  timeline: TimelineEvent[];
  evidence: Evidence[];
  knowledge: KnowledgeFact[];
  testimony: TestimonyLine[];
  alibis: Alibi[];
  autopsy: AutopsyReport;

  redHerringPersonIds: PersonId[];
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
  const suspects = truth.people.filter((p) => p.id !== truth.victimId);
  return {
    seed: truth.seed,
    difficulty: truth.difficulty,
    crimeType: truth.crimeType,
    victimName: `${victim.firstName} ${victim.lastName}`,
    victimAge: victim.age,
    discoveryLocationName: location?.name ?? "Lieu inconnu",
    discoveryDescription: `Le corps de ${victim.firstName} ${victim.lastName} a été découvert.`,
    reportedAt: truth.crimeTimestamp + 60,
    suspectCount: suspects.length,
    witnessCount: truth.people.length - suspects.length - 1,
  };
}
