import type { RNG } from "../random/rng";
import type { Person } from "../types/person";
import type { TimelineEvent } from "../types/timeline";
import { timeOfDayMinutes } from "../types/time";

function clip01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Quality of the initial encoding of an observation: how well the observer
 * actually perceived what happened, at the moment it happened. */
export function computePerceptionQuality(rng: RNG, observer: Person, event: TimelineEvent): number {
  let quality = 0.35 + observer.personality.intelligence * 0.3 + (1 - observer.baselineStress) * 0.2;

  const minuteOfDay = timeOfDayMinutes(event.timestamp);
  const isNight = minuteOfDay >= 22 * 60 || minuteOfDay < 6 * 60;
  if (isNight) quality -= 0.15;

  if (event.durationMinutes <= 2) quality -= 0.1;
  if (event.actorId === observer.id) quality += 0.25; // acting in the event vs. merely witnessing it

  quality += rng.range(-0.08, 0.08);
  return clip01(quality);
}

/** Quality of recall by the time the investigation asks about it. */
export function computeMemoryQuality(rng: RNG, observer: Person, perceptionQuality: number): number {
  let quality = perceptionQuality * 0.55 + observer.personality.intelligence * 0.35;
  quality -= rng.range(0, 0.15);
  return clip01(quality);
}

export function shouldCorrupt(rng: RNG, perceptionQuality: number, memoryQuality: number): boolean {
  const corruptionRisk = clip01((1 - perceptionQuality) * 0.55 + (1 - memoryQuality) * 0.45);
  return rng.bool(corruptionRisk * 0.65);
}
