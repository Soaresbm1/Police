import type { RNG } from "../random/rng";
import type { Person } from "../types/person";
import type { Location, LocationId } from "../types/location";
import type { MotiveCandidate } from "../case-generator/motive";
import type { EvidenceSourceTag } from "../types/timeline";

const IMPULSIVE_MOTIVES = new Set(["jealousy", "crime_passionnel", "rivalry"]);

export type MeetingScenario = "at_victim_home" | "at_culprit_home" | "neutral_ground";

export interface WeaponProfile {
  weapon: string;
  method: string;
  causeOfDeath: string;
  wounds: string[];
  physicalTags: EvidenceSourceTag[];
}

const IMPULSIVE_WEAPON_PROFILES: WeaponProfile[] = [
  {
    weapon: "couteau de cuisine",
    method: "Coup porté avec un couteau de cuisine saisi sur place, lors d'une altercation.",
    causeOfDeath: "hémorragie interne suite à une plaie par arme blanche",
    wounds: ["plaie perforante au thorax", "coupures de défense sur les avant-bras"],
    physicalTags: ["blood", "fingerprint", "dna"],
  },
  {
    weapon: "objet contondant",
    method: "Coup porté à l'aide d'un objet contondant trouvé sur les lieux.",
    causeOfDeath: "traumatisme crânien",
    wounds: ["fracture du crâne", "hématome pariétal"],
    physicalTags: ["fingerprint", "blood"],
  },
  {
    weapon: "strangulation",
    method: "Décès par strangulation manuelle lors d'une altercation.",
    causeOfDeath: "asphyxie par strangulation",
    wounds: ["ecchymoses au cou", "pétéchies conjonctivales"],
    physicalTags: ["dna", "fiber"],
  },
];

const PREMEDITATED_WEAPON_PROFILES: WeaponProfile[] = [
  {
    weapon: "couteau",
    method: "Coup porté avec un couteau apporté sur place.",
    causeOfDeath: "hémorragie interne suite à une plaie par arme blanche",
    wounds: ["plaie perforante profonde", "trajectoire descendante unique"],
    physicalTags: ["blood", "fingerprint", "dna"],
  },
  {
    weapon: "arme à feu",
    method: "Décès par arme à feu, tir à courte distance.",
    causeOfDeath: "hémorragie massive suite à une blessure par balle",
    wounds: ["orifice d'entrée thoracique", "résidus de tir à proximité de la plaie"],
    physicalTags: ["blood"],
  },
  {
    weapon: "corde",
    method: "Décès par strangulation à l'aide d'une corde apportée sur place.",
    causeOfDeath: "asphyxie par strangulation",
    wounds: ["sillon cervical net", "absence de traces de lutte importantes"],
    physicalTags: ["fiber", "dna"],
  },
];

export interface CrimePlan {
  premeditated: boolean;
  scenario: MeetingScenario;
  crimeLocationId: LocationId;
  weaponProfile: WeaponProfile;
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

  const weaponProfile = premeditated ? rng.pick(PREMEDITATED_WEAPON_PROFILES) : rng.pick(IMPULSIVE_WEAPON_PROFILES);
  const crimeLocationId = pickCrimeLocation(rng, scenario, victim, culprit, neutralCandidates);

  return { premeditated, scenario, crimeLocationId, weaponProfile };
}
