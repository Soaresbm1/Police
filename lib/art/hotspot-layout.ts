import type { SemanticAnchor } from "./crime-scene-layouts";

/**
 * Living Investigation System — Generated Art V2C-1.
 *
 * Purely visual placement for crime-scene hotspot markers. Takes only
 * ids/semantic labels/positions — never evidence state, never truth. The
 * engine (`lib/game-session/crime-scene.ts#getCrimeSceneHotspots`) remains
 * the sole authority on which hotspots exist and what they mean; this
 * module only ever repositions markers it's handed, and never drops one.
 *
 * No vision/image analysis happens here (that's the deferred V2C-2) — this
 * is a deterministic, zero-cost, pure-function fix for two real, un-related
 * problems:
 * 1. The generated image is a fixed 1024x1024 SQUARE rendered `object-cover`
 *    into a container whose aspect ratio changes by breakpoint (4:5 mobile,
 *    16:9 desktop+) — a raw zone position can fall inside the cropped-away
 *    region on one breakpoint and not the other. `objectCoverTransform`
 *    corrects for this exactly.
 * 2. Two zones that were comfortably separated before the transform can end
 *    up compressed close together after it (the transform stretches/crops
 *    asymmetrically per axis) — `resolveHotspotLayout` clamps every marker
 *    into a safe margin and deterministically nudges away any resulting
 *    near-overlap, never removing a marker and never using randomness.
 */

export interface EngineHotspotAnchor {
  id: string;
  semanticAnchor: SemanticAnchor;
  /** Deterministic source-image-normalized position, 0-100, as already
   * defined in `crime-scene-layouts.ts`'s `SceneZoneSlot`. */
  x: number;
  y: number;
}

export interface ResolvedHotspotPosition {
  hotspotId: string;
  xPercent: number;
  yPercent: number;
  /** Always 1 today (no vision analysis exists yet to be less than fully
   * confident about) — reserved so a future V2C-2 confidence-based fallback
   * can slot in without changing this shape. */
  confidence: number;
}

export const MOBILE_CONTAINER_ASPECT = 4 / 5;
export const DESKTOP_CONTAINER_ASPECT = 16 / 9;

/** Keeps every marker at least this far from each screen edge, in percent
 * of the container — never flush against a corner, always comfortably
 * tappable regardless of what the raw transform computed. */
const SAFE_MARGIN_PERCENT = 8;

/** Minimum center-to-center distance, in percent, below which two markers
 * are considered overlapping and one is nudged away. */
const MIN_DISTANCE_PERCENT = 10;

/** Deterministic candidate offsets tried, in order, when a nudge is
 * needed — a fixed ring pattern, never random, growing outward only if
 * the tighter ring is fully blocked. */
const NUDGE_ANGLES_DEG = [0, 45, 90, 135, 180, 225, 270, 315];
const NUDGE_RADII_PERCENT = [6, 12, 18];

function clampToMargin(value: number): number {
  return Math.min(100 - SAFE_MARGIN_PERCENT, Math.max(SAFE_MARGIN_PERCENT, value));
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Maps a source-image-normalized point (uPercent/vPercent, 0-100 each) to
 * its visible position in a container rendering that same SQUARE image via
 * CSS `object-cover`, given only the container's aspect ratio (width/height
 * — only the ratio matters for this math, never absolute pixels, which is
 * why the two fixed Tailwind breakpoint bands are enough input on their
 * own, no ResizeObserver needed).
 *
 * `object-cover` scales the square image up until it fully covers the
 * container, then centers it — cropping whichever axis ends up larger than
 * the container. This is the closed-form inverse of that: given the
 * container's own aspect ratio, where does source point (u,v) land.
 */
export function objectCoverTransform(uPercent: number, vPercent: number, containerAspect: number): { xPercent: number; yPercent: number } {
  const containerWidth = containerAspect;
  const containerHeight = 1;
  const renderedSide = Math.max(containerWidth, containerHeight);
  const offsetX = (containerWidth - renderedSide) / 2;
  const offsetY = (containerHeight - renderedSide) / 2;

  const u = uPercent / 100;
  const v = vPercent / 100;

  const xPercent = ((offsetX + u * renderedSide) / containerWidth) * 100;
  const yPercent = ((offsetY + v * renderedSide) / containerHeight) * 100;
  return { xPercent, yPercent };
}

/**
 * Resolves final, on-screen marker positions for a full set of hotspots at
 * a given container aspect ratio. Deterministic and refresh-stable: the
 * same `hotspots` set and `containerAspect` always produce the same
 * output, in the same order as the input, regardless of the input array's
 * own order (placement order is internally normalized by id).
 *
 * Never drops a hotspot, never introduces one, never reads anything about
 * evidence/discovery/truth.
 */
export function resolveHotspotLayout(hotspots: EngineHotspotAnchor[], containerAspect: number): ResolvedHotspotPosition[] {
  const placed: { id: string; x: number; y: number }[] = [];
  const ordered = [...hotspots].sort((a, b) => a.id.localeCompare(b.id));

  for (const h of ordered) {
    const raw = objectCoverTransform(h.x, h.y, containerAspect);
    let candidate = { x: clampToMargin(raw.xPercent), y: clampToMargin(raw.yPercent) };

    if (placed.some((p) => distance(p, candidate) < MIN_DISTANCE_PERCENT)) {
      findClearSpot: for (const radius of NUDGE_RADII_PERCENT) {
        for (const angleDeg of NUDGE_ANGLES_DEG) {
          const rad = (angleDeg * Math.PI) / 180;
          const nudged = {
            x: clampToMargin(candidate.x + radius * Math.cos(rad)),
            y: clampToMargin(candidate.y + radius * Math.sin(rad)),
          };
          if (!placed.some((p) => distance(p, nudged) < MIN_DISTANCE_PERCENT)) {
            candidate = nudged;
            break findClearSpot;
          }
        }
      }
      // If every deterministic candidate in the ring still collides (not
      // expected with at most ~8 hotspots in an 84x84 safe area), keep the
      // last nudge tried rather than loop unboundedly — still inside
      // margins, still fully deterministic, never dropped.
    }

    placed.push({ id: h.id, ...candidate });
  }

  const byId = new Map(placed.map((p) => [p.id, p]));
  return hotspots.map((h) => {
    const resolved = byId.get(h.id)!;
    return { hotspotId: h.id, xPercent: resolved.x, yPercent: resolved.y, confidence: 1 };
  });
}
