import type { CCTVActor, CCTVEnvironmentKind, CCTVSequenceDescriptor } from "./cctv-sequence";

/**
 * Phase U2 — CASELINE → Unity CCTV bridge. Turns an already-safe
 * `CCTVSequenceDescriptor` (see `cctv-sequence.ts`) into the small,
 * explicit, versioned JSON shape the Unity prototype's `CCTVJsonLoader`
 * understands. This is a pure mapping layer, not a new data source: it
 * reads only fields the descriptor already exposes, consumes no RNG, and
 * touches no CaseTruth beyond what `buildCCTVSequence` already resolved —
 * building this bridge output can no more perturb `CaseTruth` than building
 * the 2D sequence descriptor itself can (same guarantee, one layer further
 * downstream).
 *
 * Deliberate minimal whitelist (req. 3): every field CASELINE's descriptor
 * carries that Unity has no use for — `evidenceId`, `locationId`, `quality`,
 * `fps`, `clockStartSecond`, `grainSeed`, `visualEvents`, per-actor
 * `appearance` (heightBucket/gaitSeed) — is deliberately NOT forwarded.
 * Unity gets exactly what it needs to render "an actor, identified or not,
 * walks from A to B, in this kind of place, for this long" — nothing else.
 * `CCTVActor.identifiable` maps straight through as `identified`; there is
 * no path anywhere in this file that could read a person id, motive, or any
 * other CaseTruth-shaped field, because none of those ever reach
 * `CCTVSequenceDescriptor` in the first place (see that module's own
 * truth-safety guarantee).
 */

export const UNITY_BRIDGE_SCHEMA_VERSION = 1;

export interface UnityCCTVCameraData {
  id: string;
  position: [number, number, number];
  rotation: [number, number, number];
}

export interface UnityCCTVActorData {
  visualId: string;
  identified: boolean;
  startTime: number;
  endTime: number;
  startPosition: [number, number, number];
  endPosition: [number, number, number];
  walkSpeed: number;
}

export interface UnityCCTVScenario {
  version: number;
  scene: CCTVEnvironmentKind;
  camera: UnityCCTVCameraData;
  durationSeconds: number;
  actors: UnityCCTVActorData[];
}

/**
 * Deterministic camera PRESETS, one per environment kind — never a real 3D
 * placement CASELINE computed (it has none; a CCTV camera is only ever a
 * 2D-safe `cameraId` string plus a location, see `cctv.ts`). Picking a
 * preset by environment kind is purely a cosmetic rendering decision, the
 * same way the 2D renderer picks a background "genre" — it cannot imply
 * new evidence, since it never varies by anything but the (already
 * non-secret) environment kind.
 *
 * Phase U4.2 — retuned from the original U1 placements, which sat the
 * camera 13-15m from the walking path and made the actor read as a tiny
 * speck (the flagged U4/U4.1 weakness). Every position here targets the
 * SAME fixed reference point every environment's actor path is centered
 * on — (x=0, y=0.9, z=3), the geometric middle of the ±9m walking line
 * (`WORLD_HALF_WIDTH`) at the middle lane (`LANE_DEPTH[1]`), at roughly
 * hip height on the ~1.8m actor — chosen so a single static preset per
 * kind reads reasonably across the actor's whole path, not just its
 * exact center. `rotation` for each entry is the exact Euler angles
 * Unity's own `Quaternion.LookRotation(target - position)` computes for
 * that position/target pair (verified in-editor, not hand-derived), so
 * the camera is guaranteed to be pointed correctly rather than
 * approximately. Distances were chosen together with the per-environment
 * FOV in `CCTVCameraFraming.cs` so the actor occupies roughly 18-25% of
 * the frame height around the center of the walking path — see that
 * file's doc comment for the exact math. The camera remains a fixed,
 * static surveillance shot: no pan/tilt/zoom, no actor tracking — this
 * is still just a constant per environment kind.
 *
 * Phase U4.3 — U4.2's own deterministic occupancy measurement tooling
 * (`CCTVFramingMeasurement`/`CCTVFramingReport` in the Unity project;
 * Camera projection math, not screenshots) found the corner-mounted
 * 45°-yaw presets (parking/shop/generic) already had a correct ~19-20%
 * occupancy at the path's center, but swung as high as ~40-44% at the
 * NEAR end of the ±9m walking line, because the camera sits close to
 * that end — the likely source of the "looks bigger than expected"
 * impression from casual visual QA, which depends on where the actor
 * happens to be. Those three were moved ~30% farther out along the
 * *exact same viewing ray* toward the *same* look-at target — a pure
 * dolly-back, which is why their `rotation` values below are UNCHANGED
 * from U4.2 (scaling a position along the ray to a fixed target point
 * never changes the direction to that point) — with FOV narrowed just
 * enough to hold the center-of-path occupancy where it already was. A
 * longer effective lens at greater distance has proportionally less
 * perspective foreshortening, which is what actually flattens the
 * near/far swing (confirmed empirically after the change with the same
 * tooling, not assumed from formula alone). `street`'s center occupancy
 * (14.5%) was a little under the target floor, so it was moved ~19%
 * closer along its own ray (rotation likewise unchanged) with FOV left
 * alone. `corridor` was already flat at 20.6% across the whole path and
 * is untouched.
 */
const CAMERA_PRESETS: Record<CCTVEnvironmentKind, { position: [number, number, number]; rotation: [number, number, number] }> = {
  corridor: { position: [0, 3.6, -5.4], rotation: [17.819, 0, 0] },
  parking: { position: [-5.564, 4.93, -2.564], rotation: [27.12, 45, 0] },
  shop: { position: [-6.721, 4.67, -3.721], rotation: [21.635, 45, 0] },
  street: { position: [0, 3.802, -3.496], rotation: [24.068, 0, 0] },
  generic: { position: [-6.357, 4.8, -3.357], rotation: [23.452, 45, 0] },
};

/** World-space half-width (meters) the mapped walking line spans — kept
 * comfortably inside the Unity environment's ~30x30 floor regardless of
 * environment kind. */
const WORLD_HALF_WIDTH = 9;

/** Fixed depth (world Z) per CASELINE `path.lane` — cosmetic-only, mirrors
 * the 2D renderer's own lane→scale convention (a bigger lane index reads as
 * "nearer the camera" there; here it's simply a distinct walking line). */
const LANE_DEPTH: Record<0 | 1 | 2, number> = { 0: 6, 1: 3, 2: 0 };

function mapPercentToWorldX(percent: number): number {
  return -WORLD_HALF_WIDTH + (percent / 100) * (WORLD_HALF_WIDTH * 2);
}

function round(value: number, decimals = 3): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function mapActor(actor: CCTVActor, sequenceDurationSeconds: number): UnityCCTVActorData {
  const endTime = actor.visibleUntil ?? sequenceDurationSeconds;
  const z = LANE_DEPTH[actor.path.lane];
  const startX = mapPercentToWorldX(actor.path.xEntry);
  const endX = mapPercentToWorldX(actor.path.xExit);
  const startPosition: [number, number, number] = [round(startX), 0, z];
  const endPosition: [number, number, number] = [round(endX), 0, z];

  const span = Math.max(0.01, endTime - actor.visibleFrom);
  const distance = Math.abs(endX - startX);
  const walkSpeed = Math.max(0.1, round(distance / span, 3));

  return {
    visualId: actor.visualId,
    identified: actor.identifiable,
    startTime: round(actor.visibleFrom),
    endTime: round(endTime),
    startPosition,
    endPosition,
    walkSpeed,
  };
}

/**
 * Pure mapper: `CCTVSequenceDescriptor` → `UnityCCTVScenario` (req. 5). Same
 * input always yields byte-for-byte identical output — no RNG, no clock
 * read, no I/O.
 */
export function mapCCTVSequenceToUnityScenario(descriptor: CCTVSequenceDescriptor): UnityCCTVScenario {
  const preset = CAMERA_PRESETS[descriptor.environment] ?? CAMERA_PRESETS.generic;
  return {
    version: UNITY_BRIDGE_SCHEMA_VERSION,
    scene: descriptor.environment,
    camera: {
      id: descriptor.cameraId,
      position: preset.position,
      rotation: preset.rotation,
    },
    durationSeconds: descriptor.durationSeconds,
    actors: descriptor.actors.map((actor) => mapActor(actor, descriptor.durationSeconds)),
  };
}
