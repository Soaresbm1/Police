import type { LocationType } from "@/lib/game-engine/types/location";
import { pick } from "./hash";

export type LayoutTemplateId =
  | "apartment_living_room"
  | "bedroom"
  | "office"
  | "warehouse"
  | "alley"
  | "parking"
  | "hotel_room"
  | "restaurant_backroom";

/**
 * Purely visual/presentational classification of what kind of surface or
 * fixture a zone represents — never evidence, never truth. Derived below
 * from each zone's existing hand-placed position relative to this same
 * layout's `furniture` silhouettes (e.g. the "fenetre" zone sits directly
 * over the window rect), not from anything about the case. Used only by
 * `lib/art/hotspot-layout.ts` to reason about placement; the evidence/
 * hotspot inventory itself (`lib/game-session/crime-scene.ts`) is entirely
 * unaffected by this field's value.
 */
export type SemanticAnchor = "desk" | "floor" | "shelf" | "door" | "window" | "chair" | "cabinet" | "wall" | "generic_surface";

export interface SceneZoneSlot {
  id: string;
  label: string;
  x: number;
  y: number;
  semanticAnchor: SemanticAnchor;
}

/** A silhouette shape used to build the illustrated background — kept
 * intentionally simple (rects/ellipses/paths) so a whole room stays a
 * bounded, cheap set of SVG nodes (see req. 27, performance). */
export interface SceneShape {
  kind: "rect" | "ellipse" | "path";
  d?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  cx?: number;
  cy?: number;
  rx?: number;
  ry?: number;
  opacity?: number;
}

export interface CrimeSceneLayout {
  id: LayoutTemplateId;
  label: string;
  /** Base wall/floor hues (HSL hue, 0-360) — lighting.ts modulates
   * lightness/saturation from these per time-of-day. */
  wallHue: number;
  floorHue: number;
  /** Static furniture silhouettes, drawn behind the hotspot layer. */
  furniture: SceneShape[];
  /** Seven interactable zones (matches the existing fixed-zone count in
   * `lib/game-session/crime-scene.ts`) — real discoverable evidence and
   * flavor decoys are shuffled across these deterministically. */
  zones: SceneZoneSlot[];
}

const LAYOUTS: Record<LayoutTemplateId, CrimeSceneLayout> = {
  apartment_living_room: {
    id: "apartment_living_room",
    label: "Salon d'appartement",
    wallHue: 30,
    floorHue: 25,
    furniture: [
      { kind: "rect", x: 8, y: 62, w: 28, h: 16, opacity: 0.5 }, // sofa
      { kind: "rect", x: 40, y: 70, w: 20, h: 8, opacity: 0.45 }, // coffee table
      { kind: "rect", x: 70, y: 10, w: 22, h: 30, opacity: 0.35 }, // window
      { kind: "rect", x: 78, y: 55, w: 14, h: 32, opacity: 0.4 }, // cabinet
      { kind: "rect", x: 6, y: 12, w: 16, h: 34, opacity: 0.3 }, // bookshelf
    ],
    zones: [
      { id: "table", label: "Table basse", x: 28, y: 68, semanticAnchor: "generic_surface" },
      { id: "fenetre", label: "Fenêtre", x: 82, y: 18, semanticAnchor: "window" },
      { id: "porte", label: "Porte d'entrée", x: 14, y: 22, semanticAnchor: "door" },
      { id: "sol", label: "Sol", x: 62, y: 82, semanticAnchor: "floor" },
      { id: "telephone", label: "Téléphone", x: 72, y: 50, semanticAnchor: "generic_surface" },
      { id: "poubelle", label: "Poubelle", x: 18, y: 78, semanticAnchor: "floor" },
      { id: "armoire", label: "Armoire", x: 86, y: 62, semanticAnchor: "cabinet" },
    ],
  },
  bedroom: {
    id: "bedroom",
    label: "Chambre",
    wallHue: 250,
    floorHue: 30,
    furniture: [
      { kind: "rect", x: 10, y: 45, w: 40, h: 30, opacity: 0.5 }, // bed
      { kind: "rect", x: 62, y: 15, w: 18, h: 24, opacity: 0.35 }, // window
      { kind: "rect", x: 60, y: 55, w: 30, h: 34, opacity: 0.4 }, // wardrobe
      { kind: "rect", x: 8, y: 12, w: 16, h: 12, opacity: 0.3 }, // nightstand
    ],
    zones: [
      { id: "table", label: "Table de chevet", x: 12, y: 40, semanticAnchor: "generic_surface" },
      { id: "fenetre", label: "Fenêtre", x: 70, y: 20, semanticAnchor: "window" },
      { id: "porte", label: "Porte de la chambre", x: 12, y: 20, semanticAnchor: "door" },
      { id: "sol", label: "Sol, sous le lit", x: 34, y: 82, semanticAnchor: "floor" },
      { id: "telephone", label: "Téléphone", x: 16, y: 50, semanticAnchor: "generic_surface" },
      { id: "poubelle", label: "Corbeille", x: 84, y: 22, semanticAnchor: "floor" },
      { id: "armoire", label: "Armoire", x: 76, y: 66, semanticAnchor: "cabinet" },
    ],
  },
  office: {
    id: "office",
    label: "Bureau",
    wallHue: 205,
    floorHue: 210,
    furniture: [
      { kind: "rect", x: 30, y: 42, w: 40, h: 22, opacity: 0.5 }, // desk
      { kind: "rect", x: 74, y: 10, w: 20, h: 60, opacity: 0.3 }, // window wall
      { kind: "rect", x: 6, y: 12, w: 16, h: 36, opacity: 0.35 }, // filing cabinet
      { kind: "rect", x: 32, y: 68, w: 12, h: 16, opacity: 0.4 }, // chair
    ],
    zones: [
      { id: "table", label: "Bureau", x: 50, y: 50, semanticAnchor: "desk" },
      { id: "fenetre", label: "Fenêtre", x: 84, y: 30, semanticAnchor: "window" },
      { id: "porte", label: "Porte du bureau", x: 12, y: 24, semanticAnchor: "door" },
      { id: "sol", label: "Sol, sous le bureau", x: 50, y: 78, semanticAnchor: "floor" },
      { id: "telephone", label: "Téléphone fixe", x: 62, y: 46, semanticAnchor: "desk" },
      { id: "poubelle", label: "Corbeille à papier", x: 20, y: 74, semanticAnchor: "floor" },
      { id: "armoire", label: "Classeur", x: 14, y: 30, semanticAnchor: "cabinet" },
    ],
  },
  warehouse: {
    id: "warehouse",
    label: "Entrepôt",
    wallHue: 40,
    floorHue: 20,
    furniture: [
      { kind: "rect", x: 6, y: 20, w: 22, h: 42, opacity: 0.5 }, // stacked crates
      { kind: "rect", x: 66, y: 14, w: 26, h: 50, opacity: 0.45 }, // shelving
      { kind: "rect", x: 34, y: 66, w: 30, h: 16, opacity: 0.35 }, // pallet
      { kind: "rect", x: 40, y: 6, w: 20, h: 8, opacity: 0.25 }, // overhead beam
    ],
    zones: [
      { id: "table", label: "Caisses empilées", x: 18, y: 44, semanticAnchor: "generic_surface" },
      { id: "fenetre", label: "Verrière", x: 50, y: 10, semanticAnchor: "window" },
      { id: "porte", label: "Porte de quai", x: 12, y: 74, semanticAnchor: "door" },
      { id: "sol", label: "Sol en béton", x: 50, y: 84, semanticAnchor: "floor" },
      { id: "telephone", label: "Établi", x: 76, y: 60, semanticAnchor: "generic_surface" },
      { id: "poubelle", label: "Bidon métallique", x: 84, y: 24, semanticAnchor: "generic_surface" },
      { id: "armoire", label: "Casier à outils", x: 66, y: 20, semanticAnchor: "shelf" },
    ],
  },
  alley: {
    id: "alley",
    label: "Ruelle",
    wallHue: 210,
    floorHue: 200,
    furniture: [
      { kind: "rect", x: 0, y: 0, w: 28, h: 100, opacity: 0.5 }, // building left
      { kind: "rect", x: 72, y: 0, w: 28, h: 100, opacity: 0.5 }, // building right
      { kind: "rect", x: 30, y: 60, w: 16, h: 22, opacity: 0.4 }, // dumpster
      { kind: "rect", x: 55, y: 8, w: 6, h: 30, opacity: 0.35 }, // fire escape
    ],
    zones: [
      { id: "table", label: "Conteneur", x: 38, y: 66, semanticAnchor: "generic_surface" },
      { id: "fenetre", label: "Fenêtre basse", x: 20, y: 40, semanticAnchor: "window" },
      { id: "porte", label: "Porte de service", x: 78, y: 34, semanticAnchor: "door" },
      { id: "sol", label: "Sol, entre les bâtiments", x: 50, y: 84, semanticAnchor: "floor" },
      { id: "telephone", label: "Cabine technique", x: 64, y: 54, semanticAnchor: "cabinet" },
      { id: "poubelle", label: "Poubelle renversée", x: 22, y: 78, semanticAnchor: "floor" },
      { id: "armoire", label: "Casier électrique", x: 82, y: 58, semanticAnchor: "cabinet" },
    ],
  },
  parking: {
    id: "parking",
    label: "Parking",
    wallHue: 220,
    floorHue: 215,
    furniture: [
      { kind: "rect", x: 10, y: 30, w: 30, h: 44, opacity: 0.5 }, // parked car
      { kind: "rect", x: 55, y: 30, w: 30, h: 44, opacity: 0.4 }, // parked car
      { kind: "rect", x: 0, y: 0, w: 100, h: 10, opacity: 0.3 }, // low ceiling
      { kind: "rect", x: 44, y: 4, w: 12, h: 6, opacity: 0.25 }, // pillar
    ],
    zones: [
      { id: "table", label: "Véhicule stationné", x: 25, y: 55, semanticAnchor: "generic_surface" },
      { id: "fenetre", label: "Rampe d'accès", x: 8, y: 14, semanticAnchor: "wall" },
      { id: "porte", label: "Porte piétonne", x: 90, y: 20, semanticAnchor: "door" },
      { id: "sol", label: "Sol du niveau -1", x: 50, y: 86, semanticAnchor: "floor" },
      { id: "telephone", label: "Borne d'appel", x: 70, y: 50, semanticAnchor: "wall" },
      { id: "poubelle", label: "Local poubelles", x: 82, y: 74, semanticAnchor: "wall" },
      { id: "armoire", label: "Coffret électrique", x: 48, y: 14, semanticAnchor: "cabinet" },
    ],
  },
  hotel_room: {
    id: "hotel_room",
    label: "Chambre d'hôtel",
    wallHue: 340,
    floorHue: 20,
    furniture: [
      { kind: "rect", x: 12, y: 42, w: 42, h: 32, opacity: 0.5 }, // bed
      { kind: "rect", x: 66, y: 12, w: 22, h: 26, opacity: 0.35 }, // window
      { kind: "rect", x: 62, y: 50, w: 26, h: 38, opacity: 0.4 }, // desk unit
      { kind: "rect", x: 8, y: 12, w: 14, h: 12, opacity: 0.3 }, // luggage rack
    ],
    zones: [
      { id: "table", label: "Guéridon", x: 74, y: 66, semanticAnchor: "generic_surface" },
      { id: "fenetre", label: "Fenêtre", x: 76, y: 20, semanticAnchor: "window" },
      { id: "porte", label: "Porte de la chambre", x: 12, y: 20, semanticAnchor: "door" },
      { id: "sol", label: "Sol, près du lit", x: 40, y: 82, semanticAnchor: "floor" },
      { id: "telephone", label: "Téléphone de chambre", x: 68, y: 56, semanticAnchor: "desk" },
      { id: "poubelle", label: "Corbeille", x: 18, y: 76, semanticAnchor: "floor" },
      { id: "armoire", label: "Minibar", x: 12, y: 56, semanticAnchor: "cabinet" },
    ],
  },
  restaurant_backroom: {
    id: "restaurant_backroom",
    label: "Arrière-salle de restaurant",
    wallHue: 15,
    floorHue: 20,
    furniture: [
      { kind: "rect", x: 8, y: 14, w: 30, h: 44, opacity: 0.5 }, // storage shelving
      { kind: "rect", x: 46, y: 50, w: 36, h: 20, opacity: 0.45 }, // prep table
      { kind: "rect", x: 70, y: 10, w: 22, h: 30, opacity: 0.3 }, // window
      { kind: "rect", x: 10, y: 66, w: 20, h: 20, opacity: 0.35 }, // crates
    ],
    zones: [
      { id: "table", label: "Table de préparation", x: 60, y: 58, semanticAnchor: "generic_surface" },
      { id: "fenetre", label: "Fenêtre de service", x: 82, y: 22, semanticAnchor: "window" },
      { id: "porte", label: "Porte de la cuisine", x: 14, y: 26, semanticAnchor: "door" },
      { id: "sol", label: "Sol de la réserve", x: 50, y: 84, semanticAnchor: "floor" },
      { id: "telephone", label: "Téléphone du personnel", x: 68, y: 44, semanticAnchor: "generic_surface" },
      { id: "poubelle", label: "Poubelle de cuisine", x: 20, y: 78, semanticAnchor: "floor" },
      { id: "armoire", label: "Étagère de stockage", x: 18, y: 34, semanticAnchor: "shelf" },
    ],
  },
};

const CANDIDATES_BY_LOCATION_TYPE: Record<LocationType, LayoutTemplateId[]> = {
  police_station: ["office"],
  apartment: ["apartment_living_room", "bedroom"],
  house: ["apartment_living_room", "bedroom"],
  restaurant: ["restaurant_backroom"],
  bar: ["restaurant_backroom"],
  office: ["office"],
  parking: ["parking"],
  bank: ["office"],
  pharmacy: ["office"],
  hospital: ["office"],
  train_station: ["alley"],
  gas_station: ["parking"],
  shop: ["restaurant_backroom", "office"],
  hotel: ["hotel_room"],
  park: ["alley"],
  warehouse: ["warehouse"],
};

/** Deterministically picks a layout template for a location — same
 * location (same id/type) always resolves to the same layout, so the
 * crime-scene screen and any other consumer stay in sync without needing
 * to pass the choice between them explicitly. */
export function chooseLayoutTemplate(locationType: LocationType, seed: string): LayoutTemplateId {
  const candidates = CANDIDATES_BY_LOCATION_TYPE[locationType] ?? ["apartment_living_room"];
  return pick(`${seed}:layout`, candidates);
}

export function getLayout(id: LayoutTemplateId): CrimeSceneLayout {
  return LAYOUTS[id];
}

export function getZonesForLocation(locationType: LocationType, seed: string): SceneZoneSlot[] {
  return getLayout(chooseLayoutTemplate(locationType, seed)).zones;
}

export const ALL_LAYOUT_IDS: LayoutTemplateId[] = Object.keys(LAYOUTS) as LayoutTemplateId[];
