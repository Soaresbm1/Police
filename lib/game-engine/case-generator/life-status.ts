import type { RNG } from "../random/rng";
import type { LifeStatus } from "../types/person";

export const LIFE_STATUSES: LifeStatus[] = ["student", "apprentice", "employed", "self_employed", "unemployed", "retired"];

type StatusWeights = Record<LifeStatus, number>;

/**
 * Age-weighted `LifeStatus` model, expressed as control points ("anchors")
 * linearly interpolated between — this gives smooth probability curves
 * instead of hard cliffs at bracket boundaries (design targets in the
 * project brief describe brackets, but a 16/17-year-old should be barely
 * different from an 18-year-old, not a coin-flip discontinuity).
 *
 * Weights are relative (fed to `RNG.pickWeighted`), not percentages — they
 * don't need to sum to any particular total at each anchor.
 *
 * Design targets encoded here (re-tuned per the distribution-tuning pass —
 * values solved analytically against this module's own interpolation
 * formula so each age-bracket's *sampled average* lands in the requested
 * range, then confirmed empirically in
 * `__tests__/occupation-age-consistency.test.ts`):
 * - 16-17: overwhelmingly student/apprentice (target ~85-90% combined),
 *   ordinary employment rare; retirement impossible.
 * - 18-24: student/apprentice still common but declining, employed rising
 *   through the bracket; retirement impossible.
 * - 25-34: employed/self-employed dominant (~75-85% combined); retirement
 *   impossible.
 * - 35-54: employed/self-employed dominant; retirement stays at exactly 0
 *   through age 54 (interpolation only introduces it starting at anchor 55).
 * - 55-61: employed still dominant; early retirement possible but a clear
 *   minority.
 * - 62-69: retirement share rises steadily with age (interpolated 62->66->70).
 * - 70+: retired overwhelmingly, with a small continued-employment tail.
 */
// Age 16 gets its own anchor, distinct from 17, because of a structural
// fact in `occupations.ts`: every apprentice-eligible occupation (and every
// self-employed-eligible one) has `minAge: 17` — so a "candidate apprentice"
// at exactly age 16 always has an empty compatible-occupation pool and
// `resolveOccupation` falls back to `employed`. Giving age 16 a nonzero
// `apprentice` weight would therefore silently inflate `employed` instead of
// producing any apprentices — so age 16's own weights are set as if
// apprentice/self_employed didn't exist for it, and the bracket's target
// apprentice share is carried entirely by age 17 (which is empirically
// exactly what the interpolation + fallback combination needs to land the
// 16-17 bracket average inside the requested ranges — verified in
// `__tests__/occupation-age-consistency.test.ts`).
const ANCHORS: { age: number; weights: StatusWeights }[] = [
  { age: 16, weights: { student: 88, apprentice: 0, employed: 5, self_employed: 0, unemployed: 7, retired: 0 } },
  { age: 17, weights: { student: 31, apprentice: 55, employed: 6, self_employed: 0, unemployed: 7, retired: 0 } },
  { age: 18, weights: { student: 64, apprentice: 22, employed: 20, self_employed: 1, unemployed: 9, retired: 0 } },
  { age: 24, weights: { student: 10, apprentice: 4, employed: 65, self_employed: 9, unemployed: 9, retired: 0 } },
  { age: 34, weights: { student: 4, apprentice: 1, employed: 68, self_employed: 16, unemployed: 8, retired: 0 } },
  { age: 54, weights: { student: 2, apprentice: 0, employed: 72, self_employed: 20, unemployed: 7, retired: 0 } },
  { age: 55, weights: { student: 1, apprentice: 0, employed: 75, self_employed: 19, unemployed: 7, retired: 8 } },
  { age: 62, weights: { student: 0.5, apprentice: 0, employed: 38, self_employed: 16, unemployed: 6, retired: 25 } },
  { age: 66, weights: { student: 0, apprentice: 0, employed: 26, self_employed: 11, unemployed: 4, retired: 58 } },
  { age: 70, weights: { student: 0, apprentice: 0, employed: 10, self_employed: 6, unemployed: 2, retired: 83 } },
  { age: 85, weights: { student: 0, apprentice: 0, employed: 4, self_employed: 2, unemployed: 2, retired: 92 } },
];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** The relative weight of each `LifeStatus` at a given age, linearly
 * interpolated between `ANCHORS` (clamped at the ends). Exported for
 * diagnostics/tests — see `__tests__/life-status.test.ts` for the
 * distribution report. */
export function statusWeightsForAge(age: number): StatusWeights {
  if (age <= ANCHORS[0].age) return ANCHORS[0].weights;
  const last = ANCHORS[ANCHORS.length - 1];
  if (age >= last.age) return last.weights;

  let lower = ANCHORS[0];
  let upper = last;
  for (let i = 0; i < ANCHORS.length - 1; i++) {
    if (age >= ANCHORS[i].age && age <= ANCHORS[i + 1].age) {
      lower = ANCHORS[i];
      upper = ANCHORS[i + 1];
      break;
    }
  }
  const t = (age - lower.age) / (upper.age - lower.age);
  const result = {} as StatusWeights;
  for (const status of LIFE_STATUSES) {
    result[status] = lerp(lower.weights[status], upper.weights[status], t);
  }
  return result;
}

/** Draws a single age-appropriate `LifeStatus` candidate. This is only a
 * candidate: `resolveOccupation` (occupations.ts) still has to find a
 * compatible occupation for it, and may fall back for the rare edge case
 * where none exists at this exact age. */
export function selectLifeStatus(rng: RNG, age: number): LifeStatus {
  const weights = statusWeightsForAge(age);
  return rng.pickWeighted(LIFE_STATUSES.map((status) => ({ item: status, weight: Math.max(weights[status], 0) })));
}
