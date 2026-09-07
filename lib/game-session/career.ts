import type { CaseScore } from "./scoring";

/** Ordered lowest to highest; `rankForXp` walks this to find the current one. */
export const RANKS: { name: string; minXp: number }[] = [
  { name: "Recrue", minXp: 0 },
  { name: "Agent", minXp: 100 },
  { name: "Inspecteur", minXp: 300 },
  { name: "Inspecteur principal", minXp: 700 },
  { name: "Commissaire", minXp: 1500 },
];

const XP_BY_GRADE: Record<CaseScore["grade"], number> = {
  S: 150,
  A: 100,
  B: 70,
  C: 40,
  D: 10,
};

export function rankForXp(xp: number): string {
  let current = RANKS[0].name;
  for (const r of RANKS) {
    if (xp >= r.minXp) current = r.name;
  }
  return current;
}

export function nextRank(xp: number): { name: string; xpNeeded: number } | null {
  const next = RANKS.find((r) => r.minXp > xp);
  return next ? { name: next.name, xpNeeded: next.minXp - xp } : null;
}

export function xpForCase(score: CaseScore): number {
  return XP_BY_GRADE[score.grade];
}

export interface CareerDelta {
  xpGained: number;
  newXp: number;
  previousRank: string;
  newRank: string;
  rankedUp: boolean;
}

export function applyCaseToCareer(currentXp: number, score: CaseScore): CareerDelta {
  const xpGained = xpForCase(score);
  const newXp = currentXp + xpGained;
  const previousRank = rankForXp(currentXp);
  const newRank = rankForXp(newXp);
  return { xpGained, newXp, previousRank, newRank, rankedUp: previousRank !== newRank };
}
