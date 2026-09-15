import "server-only";

import { RNG } from "../random/rng";
import type { LocationType } from "../types/location";
import type { ReconstructionEnvironmentKind, ReconstructionEventType, ReconstructionSlot } from "./reconstruction-types";

/**
 * Phase U5.1 — deterministic staging/cosmetic layer. Everything here is a
 * pure function of a case-scoped seed material string (never `Math.random`,
 * never wall-clock) so the same CaseTruth + caseId always yields byte-
 * identical output (U5.0 §17, §20). Marked `server-only` as defense-in-depth
 * even though none of this file's runtime values are secret on their own —
 * it lives in the reconstruction subsystem's server-only boundary alongside
 * `reconstruction-projector.ts` and `-events.ts`; only `reconstruction-
 * types.ts` is meant to ever reach client code (see that file's doc
 * comment).
 */

/**
 * Maps the crime location's `LocationType` onto the small reconstruction
 * environment vocabulary (U5.0 §10 — reuses the CCTV environment concept
 * without touching CCTV's own code/types at all). A separate table from
 * anything CCTV-side: changing this can never affect CCTV framing, and vice
 * versa.
 */
const ENVIRONMENT_BY_LOCATION_TYPE: Record<LocationType, ReconstructionEnvironmentKind> = {
  parking: "parking",
  shop: "shop",
  bank: "shop",
  pharmacy: "shop",
  gas_station: "shop",
  train_station: "corridor",
  hospital: "corridor",
  police_station: "corridor",
  office: "corridor",
  hotel: "corridor",
  warehouse: "corridor",
  park: "street",
  house: "generic",
  apartment: "generic",
  restaurant: "generic",
  bar: "generic",
};

export function mapLocationTypeToEnvironment(locationType: LocationType): ReconstructionEnvironmentKind {
  return ENVIRONMENT_BY_LOCATION_TYPE[locationType] ?? "generic";
}

/**
 * Fixed per-event-type staging slot (U5.0 §9/§11). A presentation choice,
 * never a factual coordinate claim — see `ReconstructionSlot`'s doc comment.
 * "meet" reads as the scene's arrival framing, "talk" as the confrontation
 * proper, "attack"/"discover" both anchor to the same crime_point (the body
 * is found where it fell — an inference the autopsy's own `bodyPosition`
 * already supports, not a new claim), "leave_scene" to the exit. The two
 * taxonomy members V1 never actually emits (`phone_use`, `use_object` — see
 * reconstruction-events.ts) still get a defined slot so the mapping stays
 * total and a later phase extending V1 doesn't need to touch this table.
 */
const SLOT_BY_EVENT_TYPE: Record<ReconstructionEventType, ReconstructionSlot> = {
  meet: "entrance",
  talk: "interaction",
  attack: "crime_point",
  phone_use: "interior_center",
  leave_scene: "exit",
  use_object: "crime_point",
  discover: "crime_point",
  stage_scene: "interior_center",
};

export function slotForEventType(type: ReconstructionEventType): ReconstructionSlot {
  return SLOT_BY_EVENT_TYPE[type];
}

/**
 * Opaque, deterministic per-actor visual id (U5.0 §12/§20). A fresh RNG
 * stream keyed by `(caseId, personId)` means the result depends only on
 * that pair, never on call order or on what else was drawn from any other
 * stream — two different people always get different ids, and re-running
 * the projector for the same case always reproduces the same id for the
 * same person. `RNG.id()` hashes the stream's own seed material (see
 * `random/rng.ts`), so no PersonId substring can appear in the output.
 */
export function deriveActorVisualId(caseId: string, personId: string): string {
  return new RNG(`reconstruction::${caseId}::actor::${personId}`).id("actor");
}

/**
 * A tiny, closed cosmetic vocabulary (U5.0 §13) — clothing category only.
 * Deliberately does NOT read `Person.sex`, `.age`, `.wealthChf`,
 * `.personality`, `.lifeStatus`, `.roles`, or anything else that could let
 * an appearance choice leak guilt, motive, wealth, or identity: the CCTV
 * actor rig this reconstruction reuses (U5.0 §18/§23) is a single generic
 * humanoid with no sex/age variation to begin with, so deriving a
 * "likeness" from those fields would be fabrication CaseTruth doesn't
 * support, not a real rendering capability. The only two inputs are
 * `caseId` and `personId`, seeded through the same RNG convention as
 * `deriveActorVisualId` — deterministic, never `Math.random()`.
 */
const CLOTHING_CATEGORIES = ["casual", "formal", "workwear", "outerwear"] as const;
const CLOTHING_TONES = ["dark", "light", "neutral"] as const;

export function deriveGenericAppearance(caseId: string, personId: string): string {
  const rng = new RNG(`reconstruction::${caseId}::appearance::${personId}`);
  const category = rng.pick(CLOTHING_CATEGORIES);
  const tone = rng.pick(CLOTHING_TONES);
  return `${category}_${tone}`;
}
