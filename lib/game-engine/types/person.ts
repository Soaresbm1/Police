import type { LocationId } from "./location";

export type PersonId = string;

export type Sex = "male" | "female";

/** Big-Five-adjacent traits, each normalized to [0, 1]. These drive both
 * generation decisions (who lies, who panics, who has a plausible motive)
 * and, later, interrogation dialogue behavior. */
export interface Personality {
  intelligence: number;
  impulsivity: number;
  sociability: number;
  aggressiveness: number;
  honesty: number;
  loyalty: number;
  fearfulness: number;
}

export interface DigitalAccount {
  platform: string;
  handle: string;
}

export interface Vehicle {
  plate: string;
  make: string;
  model: string;
  color: string;
}

export type PersonRole = "victim" | "culprit" | "accomplice" | "witness" | "bystander";

export interface Person {
  id: PersonId;
  firstName: string;
  lastName: string;
  age: number;
  sex: Sex;
  profession: string;
  homeLocationId: LocationId;
  workLocationId: LocationId | null;
  avatarSeed: string;
  personality: Personality;
  baselineStress: number;
  wealthChf: number;
  addictions: string[];
  phoneNumber: string;
  vehicle: Vehicle | null;
  digitalAccounts: DigitalAccount[];
  /** Populated once the case is fully assembled; not chosen at person-creation time. */
  roles: PersonRole[];
}

export function fullName(person: Person): string {
  return `${person.firstName} ${person.lastName}`;
}
