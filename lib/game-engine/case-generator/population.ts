import type { RNG } from "../random/rng";
import type { Person, Sex, Vehicle } from "../types/person";
import type { Location, LocationId } from "../types/location";
import { createHomeLocation } from "../world/world-generator";
import {
  ADDICTIONS_POOL,
  CAR_COLORS,
  CAR_MAKES,
  FEMALE_FIRST_NAMES,
  LAST_NAMES,
  MALE_FIRST_NAMES,
  PROFESSIONS,
} from "../world/data";

export interface PopulationConfig {
  suspectCount: number;
  witnessCount: number;
}

export interface PopulationResult {
  people: Person[];
  homeLocations: Location[];
}

const PROFESSION_TO_LOCATION_TYPE: Record<string, Location["type"] | undefined> = {
  "employé·e de banque": "bank",
  "barman/barmaid": "bar",
  "serveur·se": "restaurant",
  policier: "police_station",
  médecin: "hospital",
  "infirmier·ère": "hospital",
};

const NO_WORKPLACE_PROFESSIONS = new Set(["chômeur·se", "retraité·e", "étudiant·e"]);

function randomPersonality(rng: RNG) {
  return {
    intelligence: rng.range(0.15, 0.95),
    impulsivity: rng.range(0.05, 0.95),
    sociability: rng.range(0.05, 0.95),
    aggressiveness: rng.range(0.05, 0.9),
    honesty: rng.range(0.1, 0.95),
    loyalty: rng.range(0.1, 0.95),
    fearfulness: rng.range(0.05, 0.9),
  };
}

function randomPhoneNumber(rng: RNG): string {
  const rest = Array.from({ length: 7 }, () => rng.int(0, 9)).join("");
  return `079${rest}`.replace(/(\d{3})(\d{3})(\d{2})(\d{2})/, "0$2 $3 $4");
}

function randomVehicle(rng: RNG): Vehicle | null {
  if (!rng.bool(0.65)) return null;
  const letters = Array.from({ length: 2 }, () => String.fromCharCode(65 + rng.int(0, 25))).join("");
  const digits = rng.int(100, 999);
  return {
    plate: `VD ${letters} ${digits}`,
    make: rng.pick(CAR_MAKES),
    model: `Modèle ${rng.int(1, 9)}`,
    color: rng.pick(CAR_COLORS),
  };
}

function pickWorkplace(rng: RNG, profession: string, infrastructure: Location[]): LocationId | null {
  if (NO_WORKPLACE_PROFESSIONS.has(profession)) return null;
  const preferredType = PROFESSION_TO_LOCATION_TYPE[profession];
  if (preferredType) {
    const matches = infrastructure.filter((l) => l.type === preferredType);
    if (matches.length > 0) return rng.pick(matches).id;
  }
  const offices = infrastructure.filter((l) => l.type === "office" || l.type === "shop");
  if (offices.length > 0 && rng.bool(0.7)) return rng.pick(offices).id;
  return null;
}

function generateOnePerson(rng: RNG, index: number, infrastructure: Location[]): { person: Person; home: Location } {
  const sex: Sex = rng.bool(0.5) ? "male" : "female";
  const firstName = rng.pick(sex === "male" ? MALE_FIRST_NAMES : FEMALE_FIRST_NAMES);
  const lastName = rng.pick(LAST_NAMES);
  const age = rng.int(19, 78);
  const profession = rng.pick(PROFESSIONS);
  const wealthChf = Math.round(rng.range(5_000, 900_000));
  const home = createHomeLocation(rng.derive("home"), wealthChf);
  const workLocationId = pickWorkplace(rng.derive("workplace"), profession, infrastructure);

  const addictionCount = rng.bool(0.75) ? 0 : rng.int(1, 2);
  const addictions = addictionCount > 0 ? rng.sample(ADDICTIONS_POOL, addictionCount) : [];

  const person: Person = {
    id: rng.id("person"),
    firstName,
    lastName,
    age,
    sex,
    profession,
    homeLocationId: home.id,
    workLocationId,
    avatarSeed: `${firstName}-${lastName}-${index}`,
    personality: randomPersonality(rng.derive("personality")),
    baselineStress: rng.range(0.1, 0.6),
    wealthChf,
    addictions,
    phoneNumber: randomPhoneNumber(rng.derive("phone")),
    vehicle: randomVehicle(rng.derive("vehicle")),
    digitalAccounts: [{ platform: "téléphonie mobile", handle: `${firstName.toLowerCase()}.${lastName.toLowerCase()}` }],
    roles: [],
  };

  return { person, home };
}

export function generatePopulation(
  rng: RNG,
  infrastructure: Location[],
  config: PopulationConfig,
): PopulationResult {
  const total = 1 + config.suspectCount + config.witnessCount;
  const people: Person[] = [];
  const homeLocations: Location[] = [];

  for (let i = 0; i < total; i++) {
    const { person, home } = generateOnePerson(rng.derive(`cast-${i}`), i, infrastructure);
    people.push(person);
    homeLocations.push(home);
  }

  return { people, homeLocations };
}
