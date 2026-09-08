import { TOWN_NAME } from "./data";

/**
 * The fictional city's identity — one place for everything that should stay
 * consistent across every procedurally generated case: what the city is
 * called, who polices it, how its districts are laid out, how streets are
 * named, and how case numbers are formatted.
 *
 * Deliberately lives in the engine (not the UI) because geography feeds
 * generation: a location's district is derived from its coordinates, and
 * street names are drawn from that district's own pool, so an address is
 * never inconsistent with where the building actually stands.
 */
export const CITY = {
  name: TOWN_NAME,
  canton: "Vaud",
  policeDepartment: `Police cantonale de ${TOWN_NAME}`,
  policeShortName: "Police cantonale",
  caseNumberPrefix: "CL",
  emergencyBand: "CENTRAL-02",
} as const;

export type DistrictId = "centre" | "vieille-ville" | "rive" | "tilleuls" | "industrie" | "hauts";

export interface District {
  id: DistrictId;
  name: string;
  /** Which quadrant-ish slice of the 8×8km grid this district covers.
   * Deliberately coarse — it only needs to be stable and plausible, not a
   * real cadastral map. */
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  streets: string[];
}

const HALF = 4;
const FULL = 8;

export const DISTRICTS: District[] = [
  {
    id: "centre",
    name: "Centre",
    bounds: { minX: 2.5, maxX: 5.5, minY: 2.5, maxY: 5.5 },
    streets: ["rue Centrale", "rue du Marché", "avenue de la Paix", "rue des Écoles"],
  },
  {
    id: "vieille-ville",
    name: "Vieille-Ville",
    bounds: { minX: 0, maxX: 2.5, minY: 0, maxY: HALF },
    streets: ["rue des Fontaines", "ruelle du Chapitre", "rue Basse", "place de l'Horloge"],
  },
  {
    id: "rive",
    name: "Rive",
    bounds: { minX: 0, maxX: FULL, minY: 5.5, maxY: FULL },
    streets: ["rue du Lac", "quai des Pêcheurs", "chemin des Roseaux", "avenue du Port"],
  },
  {
    id: "tilleuls",
    name: "Les Tilleuls",
    bounds: { minX: 5.5, maxX: FULL, minY: 0, maxY: HALF },
    streets: ["chemin des Vignes", "chemin des Pins", "allée des Tilleuls", "chemin du Moulin"],
  },
  {
    id: "industrie",
    name: "Zone industrielle",
    bounds: { minX: 5.5, maxX: FULL, minY: HALF, maxY: 5.5 },
    streets: ["route de l'Industrie", "avenue du Stand", "chemin des Entrepôts"],
  },
  {
    id: "hauts",
    name: "Les Hauts",
    bounds: { minX: 0, maxX: 2.5, minY: HALF, maxY: 5.5 },
    streets: ["avenue des Alpes", "chemin du Belvédère", "route de la Corniche"],
  },
];

/** Which district a point on the town grid belongs to. Falls back to the
 * Centre for anything the coarse bounds above don't cover, so this can
 * never return undefined for a valid in-town coordinate. */
export function districtForCoordinates(x: number, y: number): District {
  const match = DISTRICTS.find((d) => x >= d.bounds.minX && x < d.bounds.maxX && y >= d.bounds.minY && y < d.bounds.maxY);
  return match ?? DISTRICTS[0];
}

/** `CL-2026-0421` — stable per case, derived from the case seed so the same
 * seed always produces the same case number, and readable as a real police
 * reference rather than a raw seed string. */
export function formatCaseNumber(seed: string, year = new Date().getFullYear()): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  const serial = (Math.abs(hash) % 9999) + 1;
  return `${CITY.caseNumberPrefix}-${year}-${serial.toString().padStart(4, "0")}`;
}
