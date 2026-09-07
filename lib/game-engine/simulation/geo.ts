import type { Coordinates, Location } from "../types/location";

/** Perpendicular distance (km) from point p to the segment a-b, clamped to the segment. */
function distanceToSegmentKm(p: Coordinates, a: Coordinates, b: Coordinates): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.hypot(p.x - projX, p.y - projY);
}

/**
 * Finds a location that a straight-line trip between `from` and `to` would
 * plausibly pass near — e.g. a gas station between the crime scene and the
 * culprit's home whose wifi or camera can pick them up. This is what makes
 * "his phone connected to the gas station wifi" a physically grounded clue
 * rather than an arbitrary narrative flourish.
 */
export function findRouteWaypoint(
  from: Coordinates,
  to: Coordinates,
  candidates: Location[],
  maxOffsetKm = 0.6,
): Location | undefined {
  let best: { location: Location; distance: number } | undefined;
  for (const location of candidates) {
    const distance = distanceToSegmentKm(location.coordinates, from, to);
    if (distance <= maxOffsetKm && (!best || distance < best.distance)) {
      best = { location, distance };
    }
  }
  return best?.location;
}
