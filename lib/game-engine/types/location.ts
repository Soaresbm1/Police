import type { PersonId } from "./person";

export type LocationId = string;

export type LocationType =
  | "police_station"
  | "apartment"
  | "house"
  | "restaurant"
  | "bar"
  | "office"
  | "parking"
  | "bank"
  | "pharmacy"
  | "hospital"
  | "train_station"
  | "gas_station"
  | "shop"
  | "hotel"
  | "park"
  | "warehouse";

export interface Coordinates {
  /** Abstract town-grid coordinates in kilometers, used only for travel-time math. */
  x: number;
  y: number;
}

export interface OpeningHours {
  /** Minutes from midnight. `open > close` means it spans midnight. */
  open: number;
  close: number;
}

export interface Location {
  id: LocationId;
  name: string;
  type: LocationType;
  address: string;
  /** Human-readable district name, derived from `coordinates` at
   * generation time (see world/city.ts) so an address is always
   * consistent with where the building actually stands. */
  district: string;
  coordinates: Coordinates;
  hasCameras: boolean;
  cameraZones: string[];
  hasWifi: boolean;
  wifiSsid: string | null;
  hasBadgeAccess: boolean;
  openingHours: OpeningHours | null;
  employeePersonIds: PersonId[];
  residentPersonIds: PersonId[];
}

export type TravelMode = "foot" | "car";

const WALK_KM_PER_HOUR = 5;
const CAR_KM_PER_HOUR = 35;

export function distanceKm(a: Coordinates, b: Coordinates): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Travel time in minutes between two points, rounded up so 0-distance still
 * costs a minimum of 1 minute (you can't teleport within the same building
 * instantly for scheduling purposes). */
export function travelMinutes(a: Coordinates, b: Coordinates, mode: TravelMode): number {
  const km = distanceKm(a, b);
  const speed = mode === "car" ? CAR_KM_PER_HOUR : WALK_KM_PER_HOUR;
  return Math.max(1, Math.ceil((km / speed) * 60));
}

export function isOpenAt(hours: OpeningHours | null, minuteOfDay: number): boolean {
  if (!hours) return true;
  if (hours.open <= hours.close) {
    return minuteOfDay >= hours.open && minuteOfDay < hours.close;
  }
  // Spans midnight.
  return minuteOfDay >= hours.open || minuteOfDay < hours.close;
}
