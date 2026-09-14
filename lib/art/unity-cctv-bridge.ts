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
 */
const CAMERA_PRESETS: Record<CCTVEnvironmentKind, { position: [number, number, number]; rotation: [number, number, number] }> = {
  parking: { position: [-9, 4.2, -9], rotation: [28, 40, 0] },
  corridor: { position: [0, 4.6, -13], rotation: [22, 0, 0] },
  shop: { position: [-7, 4, -7], rotation: [24, 35, 0] },
  street: { position: [0, 4.5, -14], rotation: [18, 0, 0] },
  generic: { position: [-6, 4.2, -6], rotation: [26, 38, 0] },
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
