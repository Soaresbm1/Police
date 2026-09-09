import type { Person, PersonId } from "@/lib/game-engine/types/person";
import type { Location, LocationId, LocationType } from "@/lib/game-engine/types/location";
import type { CaseTruth } from "@/lib/game-engine/types/case";
import { timeOfDayMinutes } from "@/lib/game-engine/types/time";
import { hashSeed, pick, pickChance } from "./hash";
import type { TimeOfDay } from "./lighting";
import { chooseLayoutTemplate, type LayoutTemplateId } from "./crime-scene-layouts";
import { buildCCTVFrameDescriptor, type CCTVFrameDescriptor } from "./cctv";
import { rendererKindForEvidence, type EvidenceRendererKind } from "./evidence-kind";

// ---------------------------------------------------------------------
// Character visual identity
// ---------------------------------------------------------------------

export type Presentation = "masculine" | "feminine";
export type Hairstyle = "short" | "buzz" | "shoulder" | "long" | "bald" | "bun" | "curly" | "ponytail";
export type FaceShape = "oval" | "square" | "round" | "angular";
export type ClothingCategory = "casual" | "formal" | "workwear" | "uniform" | "sport";

/**
 * The exact fields `buildCharacterVisualDescriptor` reads, and no more —
 * `Person`'s full shape (personality, wealth, roles, ...) is deliberately
 * NOT the parameter type, so passing a smaller, already-guilt-safe view
 * (e.g. `PersonPublicView` from `lib/game-session/player-view.ts`, used
 * throughout the gameplay UI) satisfies this structurally without any
 * cast. This is the guilt-safety guarantee made checkable by the
 * compiler, not just documented: there is no field here `roles`/`Person`
 * could smuggle guilt through even if someone tried.
 */
export type GuiltSafePersonFields = Pick<Person, "id" | "age" | "sex" | "profession" | "avatarSeed">;

/**
 * A person's deterministic visual identity. Built from guilt-safe fields
 * ONLY — this function has no way to know who the culprit is, so it is
 * structurally impossible for guilt to bias a portrait. Never widen the
 * parameter type to `Person` or `CaseTruth`; if a future change needs
 * one, that is a sign the guilt-safety guarantee is being broken.
 */
export interface CharacterVisualDescriptor {
  personId: PersonId;
  seed: string;
  approxAge: "young" | "middle" | "older";
  presentation: Presentation;
  hairstyle: Hairstyle;
  hairColor: string;
  faceShape: FaceShape;
  clothingCategory: ClothingCategory;
  skinTone: string;
  /** "front": facing the camera. "slight_turn": head turned very slightly
   * off-axis — a subtle, mundane variation (an ordinary snapshot rarely
   * has a perfectly square head angle), not a deliberate professional
   * three-quarter portrait pose. Weighted toward "front" (see
   * `buildCharacterVisualDescriptor`) since that's the norm for an
   * administrative record photo. */
  framing: "front" | "slight_turn";
}

const HAIRSTYLES_BY_PRESENTATION: Record<Presentation, Hairstyle[]> = {
  masculine: ["short", "buzz", "curly", "bald", "short"],
  feminine: ["shoulder", "long", "bun", "ponytail", "curly"],
};
const HAIR_COLORS = ["#2b2420", "#4a3728", "#6b4a2f", "#8a6b45", "#3d3d3d", "#c9c2b0", "#1a1714"];
const SKIN_TONES = ["#e8c9a8", "#d4a878", "#b98858", "#8f6239", "#5c4028", "#f0d5b8"];
const FACE_SHAPES: FaceShape[] = ["oval", "square", "round", "angular"];

function clothingCategoryForProfession(profession: string): ClothingCategory {
  const p = profession.toLowerCase();
  if (/(police|agent|gendarme|militaire|garde|douanier)/.test(p)) return "uniform";
  if (/(avocat|médecin|directeur|directrice|notaire|banquier|banquière|cadre|juge|ingénieur|comptable)/.test(p)) return "formal";
  if (/(ouvrier|ouvrière|mécanicien|mécanicienne|usine|chantier|artisan|électricien|plombier|magasinier)/.test(p)) return "workwear";
  if (/(coach|sport|entraîneur|entraîneuse|moniteur|monitrice)/.test(p)) return "sport";
  return "casual";
}

export function buildCharacterVisualDescriptor(person: GuiltSafePersonFields): CharacterVisualDescriptor {
  const seed = person.avatarSeed;
  const presentation: Presentation = person.sex === "male" ? "masculine" : "feminine";
  const approxAge = person.age < 32 ? "young" : person.age < 55 ? "middle" : "older";
  return {
    personId: person.id,
    seed,
    approxAge,
    presentation,
    hairstyle: pick(`${seed}:hair`, HAIRSTYLES_BY_PRESENTATION[presentation]),
    hairColor: pick(`${seed}:haircolor`, HAIR_COLORS),
    faceShape: pick(`${seed}:face`, FACE_SHAPES),
    clothingCategory: clothingCategoryForProfession(person.profession),
    skinTone: pick(`${seed}:skin`, SKIN_TONES),
    // Mostly front-facing, like a real administrative photo — only a
    // minority get a subtle head-angle variation, never a posed portrait
    // angle. Guilt-safe: keyed purely off the person's own seed.
    framing: pickChance(`${seed}:framing`, 0.75) ? "front" : "slight_turn",
  };
}

// ---------------------------------------------------------------------
// Location visual identity
// ---------------------------------------------------------------------

export type ArchitectureStyle = "residential_modern" | "residential_old" | "commercial" | "industrial" | "institutional" | "hospitality" | "outdoor";

export interface LocationVisualDescriptor {
  locationId: LocationId;
  seed: string;
  locationType: LocationType;
  architectureStyle: ArchitectureStyle;
}

const ARCHITECTURE_BY_TYPE: Record<LocationType, ArchitectureStyle> = {
  police_station: "institutional",
  apartment: "residential_modern",
  house: "residential_old",
  restaurant: "hospitality",
  bar: "hospitality",
  office: "commercial",
  parking: "industrial",
  bank: "institutional",
  pharmacy: "commercial",
  hospital: "institutional",
  train_station: "institutional",
  gas_station: "commercial",
  shop: "commercial",
  hotel: "hospitality",
  park: "outdoor",
  warehouse: "industrial",
};

export function buildLocationVisualDescriptor(location: Location): LocationVisualDescriptor {
  return {
    locationId: location.id,
    seed: `${location.id}:${location.type}`,
    locationType: location.type,
    architectureStyle: ARCHITECTURE_BY_TYPE[location.type],
  };
}

// ---------------------------------------------------------------------
// Crime scene visual identity
// ---------------------------------------------------------------------

/** The exact `Location` fields `buildCrimeSceneVisualDescriptor` reads, and
 * no more — mirrors `GuiltSafePersonFields` above. `Location` itself never
 * carries staging/tampering/hidden-timeline data (that lives only on
 * `CaseTruth`), but narrowing the parameter type to just `id`/`type` still
 * makes "this function cannot depend on anything CaseTruth-shaped"
 * compiler-checked rather than merely true-by-convention. */
export type GuiltSafeLocationFields = Pick<Location, "id" | "type">;

export type Weather = "clear" | "overcast" | "light_rain";

export interface CrimeSceneVisualDescriptor {
  locationId: LocationId;
  seed: string;
  layoutTemplate: LayoutTemplateId;
  timeOfDay: TimeOfDay;
  architectureStyle: ArchitectureStyle;
  /** Only meaningful for a genuinely open-air layout (currently just
   * `"alley"`) — `buildCrimeSceneEnvironmentPrompt` ignores it for every
   * interior layout. Still computed unconditionally so the descriptor
   * (and its hash) stay simple or reason about independent of layout. */
  weather: Weather;
}

const WEATHER_OPTIONS: Weather[] = ["clear", "overcast", "light_rain"];

/** Minute-of-day (0-1439) bucketed into a lighting period. */
function timeOfDayFor(minuteOfDay: number): TimeOfDay {
  if (minuteOfDay >= 6 * 60 && minuteOfDay < 18 * 60) return "day";
  if (minuteOfDay >= 18 * 60 && minuteOfDay < 22 * 60) return "evening";
  return "night";
}

/**
 * Deterministic, server-only, guilt-safe crime-scene environment
 * descriptor. Takes only `GuiltSafeLocationFields` (id/type) plus the
 * crime's timestamp (already player-visible via the autopsy report before
 * the scene is ever explored) — structurally never sees `CaseTruth` at
 * all, so staging, tampering, hidden entrances, secret occupants, the
 * culprit, or any undiscovered evidence cannot influence the generated
 * environment even by accident.
 */
export function buildCrimeSceneVisualDescriptor(location: GuiltSafeLocationFields, crimeTimestamp: number): CrimeSceneVisualDescriptor {
  const seed = `${location.id}:${location.type}`;
  return {
    locationId: location.id,
    seed,
    layoutTemplate: chooseLayoutTemplate(location.type, seed),
    timeOfDay: timeOfDayFor(timeOfDayMinutes(crimeTimestamp)),
    architectureStyle: ARCHITECTURE_BY_TYPE[location.type],
    weather: pick(`${seed}:weather`, WEATHER_OPTIONS),
  };
}

// ---------------------------------------------------------------------
// Evidence visual identity
// ---------------------------------------------------------------------

export interface EvidenceVisualDescriptor {
  evidenceId: string;
  seed: string;
  rendererKind: EvidenceRendererKind;
}

// ---------------------------------------------------------------------
// Case-wide manifest — an aggregate view over every descriptor in one
// case, primarily for dev inspection (`/case-lab`) and as the documented
// single entry point a future asset-generation pipeline would consume.
// Player-facing screens call the individual builders above directly
// (they only ever need one person/location/evidence item at a time), so
// building the full manifest is not on the hot path of ordinary play.
// ---------------------------------------------------------------------

export interface CaseVisualManifest {
  caseId: string;
  people: CharacterVisualDescriptor[];
  locations: LocationVisualDescriptor[];
  crimeScene: CrimeSceneVisualDescriptor;
  evidence: EvidenceVisualDescriptor[];
  cctvFrames: CCTVFrameDescriptor[];
}

export function buildCaseVisualManifest(truth: CaseTruth): CaseVisualManifest {
  const crimeLocation = truth.locations.find((l) => l.id === truth.crimeLocationId);
  const cctvEvidence = truth.evidence.filter((ev) => ev.type === "camera_footage" || ev.type === "dashcam_footage");

  return {
    caseId: truth.seed,
    people: truth.people.map(buildCharacterVisualDescriptor),
    locations: truth.locations.map(buildLocationVisualDescriptor),
    crimeScene: crimeLocation
      ? buildCrimeSceneVisualDescriptor(crimeLocation, truth.crimeTimestamp)
      : {
          locationId: truth.crimeLocationId,
          seed: truth.crimeLocationId,
          layoutTemplate: "apartment_living_room",
          timeOfDay: "night",
          architectureStyle: "residential_modern",
          weather: "clear",
        },
    evidence: truth.evidence.map((ev) => ({ evidenceId: ev.id, seed: ev.id, rendererKind: rendererKindForEvidence(ev.type) })),
    cctvFrames: cctvEvidence.map((ev) => buildCCTVFrameDescriptor(ev, truth)),
  };
}

/** Re-exported for convenience so callers of the manifest don't need to
 * import `hashSeed` from two different modules. */
export { hashSeed };
