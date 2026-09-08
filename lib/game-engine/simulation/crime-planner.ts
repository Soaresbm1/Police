import type { RNG } from "../random/rng";
import type { Person } from "../types/person";
import type { Location, LocationId } from "../types/location";
import type { MotiveCandidate } from "../case-generator/motive";
import type { ArchetypePolicy } from "../case-generator/archetype";
import { CRIME_METHOD_PROFILES, type MethodProfile } from "./crime-methods";

const IMPULSIVE_MOTIVES = new Set(["jealousy", "crime_passionnel", "rivalry"]);

export type MeetingScenario = "at_victim_home" | "at_culprit_home" | "neutral_ground";

export type { MethodProfile } from "./crime-methods";

export interface CrimePlan {
  premeditated: boolean;
  scenario: MeetingScenario;
  crimeLocationId: LocationId;
  methodProfile: MethodProfile;
}

function pickCrimeLocation(
  rng: RNG,
  scenario: MeetingScenario,
  victim: Person,
  culprit: Person,
  neutralCandidates: Location[],
): LocationId {
  if (scenario === "at_victim_home") return victim.homeLocationId;
  if (scenario === "at_culprit_home") return culprit.homeLocationId;
  if (neutralCandidates.length === 0) return victim.homeLocationId;
  return rng.pick(neutralCandidates).id;
}

export function planCrime(
  rng: RNG,
  culprit: Person,
  motive: MotiveCandidate,
  victim: Person,
  neutralCandidates: Location[],
  archetype: ArchetypePolicy,
): CrimePlan {
  const premeditationBias = IMPULSIVE_MOTIVES.has(motive.type)
    ? (1 - culprit.personality.impulsivity) * 0.3
    : (1 - culprit.personality.impulsivity) * 0.85 + 0.15;
  const premeditated = rng.bool(Math.min(0.95, Math.max(0.05, premeditationBias)));

  const scenario: MeetingScenario = rng.pickWeighted<MeetingScenario>([
    { item: "at_victim_home", weight: 0.6 },
    { item: "at_culprit_home", weight: 0.15 },
    { item: "neutral_ground", weight: 0.25 },
  ]);

  // Method choice blends the archetype's thematic preference with how well
  // that method fits the culprit's premeditation state — a car-neutral
  // affinity keeps every archetype able to produce every method sometimes.
  const methodEntries = Object.values(CRIME_METHOD_PROFILES).map((profile) => {
    const archetypeWeight = archetype.methodWeights[profile.methodType] ?? 0.5;
    const premedFit = premeditated ? profile.premeditationAffinity : 1 - profile.premeditationAffinity;
    return { item: profile, weight: archetypeWeight * (0.3 + premedFit) };
  });
  const methodProfile = rng.pickWeighted(methodEntries);

  // A workplace conspiracy is far more plausible playing out where the two
  // of them actually cross paths unsupervised — their shared workplace —
  // than at either home, when the story-bias step (archetype-bias.ts) has
  // in fact given them one.
  const sharedWorkplace =
    archetype.id === "workplace_conspiracy" && culprit.workLocationId && culprit.workLocationId === victim.workLocationId
      ? culprit.workLocationId
      : null;
  const crimeLocationId = sharedWorkplace && rng.bool(0.7) ? sharedWorkplace : pickCrimeLocation(rng, scenario, victim, culprit, neutralCandidates);

  return { premeditated, scenario, crimeLocationId, methodProfile };
}
