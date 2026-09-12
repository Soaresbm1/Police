import type { CCTVActor } from "./cctv-sequence";

/**
 * Phase 3B — visual realism pass. Pure pose math for one CCTV actor at one
 * instant, factored out of the renderer so it can be unit-tested without a
 * DOM/canvas (this project has no jsdom/React-Testing-Library setup — see
 * the Phase 3 report — so keeping every testable rule in a plain function is
 * how coverage stays possible at all).
 *
 * Everything here is COSMETIC PRESENTATION (req. 31 from Phase 3): gait
 * cadence, walk phase, bob, idle detection. None of it is read by evidence,
 * scoring, hints, or truth code, and none of it can ever move an actor
 * outside the horizontal path (`xEntry`/`xExit`) the sequence descriptor
 * already committed to — this module only re-derives a pose from that path,
 * it never introduces new movement.
 *
 * Walk phase is deliberately computed as a pure function of *distance
 * traveled since visibleFrom*, not of elapsed real time or accumulated
 * animation state — two consequences fall out of that for free:
 *   1. Seeking is exact: `computeActorPose(actor, t, ...)` depends only on
 *      `t`, so jumping straight to `t=15` looks identical to having played
 *      through to it (req. 32/36 from Phase 3).
 *   2. An actor whose path doesn't actually move (`xEntry === xExit`, or a
 *      hypothetical future stationary segment) naturally freezes at an idle
 *      stance — "pause" behavior (req. 14 of this phase) falls out of the
 *      existing path data instead of needing an invented pause event.
 */

/** Must match the CCTV canvas's own logical width (`CCTVAnimatedPlayer`'s
 * `WIDTH`) — kept here as the canonical value so pose math and rendering
 * never drift apart. */
export const CCTV_CANVAS_WIDTH = 320;

/** Baseline (lane 1) figure height in canvas px before perspective scale. */
const BASE_FIGURE_HEIGHT_PX = 62;

/** Stride length as a fraction of figure height — tuned for a plausible
 * walking cadence at CCTV viewing distance, cosmetic only. */
const STRIDE_LENGTH_FACTOR = 0.85;

/** Below this many px of net travel since `visibleFrom`, the actor reads as
 * effectively stationary — an idle stance rather than a frozen mid-stride
 * pose. */
const IDLE_DISTANCE_THRESHOLD_PX = 0.75;

export interface CCTVActorPose {
  /** Canvas-space horizontal position of the actor's hip/spine anchor. */
  x: number;
  /** Overall figure scale from the actor's `path.lane` (perspective). */
  scale: number;
  /** Body height in canvas px at this scale — convenience for the renderer. */
  figureHeightPx: number;
  facingRight: boolean;
  /** Radians; frozen at the idle value while `idle` is true. */
  walkPhase: number;
  idle: boolean;
  /** Vertical torso/head offset (px) from the gait bob — 0 while idle. */
  bob: number;
  /** Mirrors `CCTVActor.identifiable` — never a person id or name. */
  identifiable: boolean;
}

function actorXAt(actor: CCTVActor, t: number, durationSeconds: number, canvasWidth: number): number {
  const windowEnd = actor.visibleUntil ?? durationSeconds;
  const span = windowEnd - actor.visibleFrom;
  const progress = span > 0 ? Math.min(1, Math.max(0, (t - actor.visibleFrom) / span)) : 0;
  const xEntryPx = (actor.path.xEntry / 100) * canvasWidth;
  const xExitPx = (actor.path.xExit / 100) * canvasWidth;
  return xEntryPx + (xExitPx - xEntryPx) * progress;
}

/**
 * Returns `null` when the actor isn't visible at `t` at all (outside
 * `[visibleFrom, visibleUntil]`) — the caller should draw nothing. Otherwise
 * a pure function of `(actor, t, durationSeconds)`: identical inputs always
 * yield an identical pose, and the returned `x` always lies within the
 * actor's own `[xEntry, xExit]` path bounds (in canvas px) by construction.
 */
export function computeActorPose(
  actor: CCTVActor,
  t: number,
  durationSeconds: number,
  canvasWidth: number = CCTV_CANVAS_WIDTH,
): CCTVActorPose | null {
  if (t < actor.visibleFrom) return null;
  if (actor.visibleUntil !== null && t > actor.visibleUntil) return null;

  const x = actorXAt(actor, t, durationSeconds, canvasWidth);
  const xAtStart = actorXAt(actor, actor.visibleFrom, durationSeconds, canvasWidth);
  const distanceTraveled = Math.abs(x - xAtStart);

  const scale = 0.72 + actor.path.lane * 0.16;
  const figureHeightPx = BASE_FIGURE_HEIGHT_PX * scale;
  const strideLength = figureHeightPx * STRIDE_LENGTH_FACTOR;

  // Cosmetic per-actor cadence variance so two actors in the same clip don't
  // walk in lockstep — derived only from the actor's own fixed gaitSeed, so
  // it's as deterministic/pure as everything else here.
  const cadence = 1 + (((actor.appearance.gaitSeed % 100) / 100) - 0.5) * 0.3;

  const idle = distanceTraveled < IDLE_DISTANCE_THRESHOLD_PX;
  const walkPhase = idle ? 0 : (distanceTraveled / strideLength) * Math.PI * 2 * cadence;
  const bob = idle ? 0 : Math.abs(Math.sin(walkPhase)) * figureHeightPx * 0.025;
  const facingRight = actor.path.xExit >= actor.path.xEntry;

  return { x, scale, figureHeightPx, facingRight, walkPhase, idle, bob, identifiable: actor.identifiable };
}

/**
 * Two-bone IK solve for one leg (or, reused, one arm) — given a fixed hip
 * (shoulder) point and a desired foot (hand) target, returns the knee
 * (elbow) joint and the actually-reachable foot/hand point (clamped to the
 * leg's own total reach so a large stride amplitude can never dislocate the
 * limb). Purely geometric, no randomness, no truth involved — this only
 * exists so the renderer can draw a bent limb instead of a straight one.
 */
export function solveTwoBoneIK(
  originX: number,
  originY: number,
  targetX: number,
  targetY: number,
  upperLength: number,
  lowerLength: number,
): { jointX: number; jointY: number; endX: number; endY: number } {
  const dx = targetX - originX;
  const dy = targetY - originY;
  const rawDist = Math.hypot(dx, dy) || 0.001;
  const maxReach = upperLength + lowerLength - 0.5;
  const minReach = Math.max(0.5, Math.abs(upperLength - lowerLength) + 0.5);
  const dist = Math.min(maxReach, Math.max(minReach, rawDist));
  const ux = dx / rawDist;
  const uy = dy / rawDist;
  const endX = originX + ux * dist;
  const endY = originY + uy * dist;

  const baseAngle = Math.atan2(uy, ux);
  const cosA = (upperLength * upperLength + dist * dist - lowerLength * lowerLength) / (2 * upperLength * dist);
  const bendAngle = Math.acos(Math.min(1, Math.max(-1, cosA)));
  const jointAngle = baseAngle - bendAngle;
  const jointX = originX + Math.cos(jointAngle) * upperLength;
  const jointY = originY + Math.sin(jointAngle) * upperLength;

  return { jointX, jointY, endX, endY };
}
