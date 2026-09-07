/**
 * All in-case time is represented as an integer number of minutes elapsed
 * since "Day 0, 00:00" of that case's internal calendar. This makes interval
 * math (durations, travel time, overlap checks) trivial integer arithmetic
 * instead of Date bookkeeping, and keeps CaseTruth generation independent of
 * the wall-clock date it happens to be generated on.
 */
export type GameMinutes = number;

export const MINUTES_PER_HOUR = 60;
export const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;

export function dayOf(t: GameMinutes): number {
  return Math.floor(t / MINUTES_PER_DAY);
}

export function timeOfDayMinutes(t: GameMinutes): number {
  return ((t % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/** Formats a GameMinutes value as "Jour N, HH:MM" for display/debug purposes. */
export function formatGameTime(t: GameMinutes): string {
  const day = dayOf(t) + 1;
  const minuteOfDay = timeOfDayMinutes(t);
  const hh = Math.floor(minuteOfDay / 60)
    .toString()
    .padStart(2, "0");
  const mm = (minuteOfDay % 60).toString().padStart(2, "0");
  return `Jour ${day}, ${hh}:${mm}`;
}

/** Formats a duration (elapsed minutes, not a point in time) as "Xh YYmin". */
export function formatDuration(totalMinutes: number): string {
  const minutes = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours > 0 ? `${hours}h ${remainder.toString().padStart(2, "0")}min` : `${remainder}min`;
}

export function hm(hours: number, minutes = 0): GameMinutes {
  return hours * MINUTES_PER_HOUR + minutes;
}

export function overlaps(
  aStart: GameMinutes,
  aEnd: GameMinutes,
  bStart: GameMinutes,
  bEnd: GameMinutes,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}
