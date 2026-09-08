import type { Difficulty } from "../types/case";

export interface AccompliceChanceWeights {
  none: number;
  one: number;
  two: number;
}

export interface DifficultyConfig {
  suspectCount: number;
  witnessCount: number;
  contaminationChance: number;
  redHerringCount: number;
  /** Relative weights for 0/1/2 accomplices — see accomplices.ts. */
  accompliceChance: AccompliceChanceWeights;
  /** Base probability a case attempts to stage the scene at all (before the
   * archetype/method compatibility filter narrows which staging fits). */
  stagingChance: number;
  /** Probability a suspect/witness falsely confesses. */
  falseConfessionChance: number;
  /** Probability of each deliberate, actor-driven tampering act — distinct
   * from `contaminationChance`, which is passive lab-handling noise. */
  deliberateTamperingChance: number;
}

export const DIFFICULTY_CONFIGS: Record<Difficulty, DifficultyConfig> = {
  recruit: {
    suspectCount: 4,
    witnessCount: 6,
    contaminationChance: 0.03,
    redHerringCount: 1,
    accompliceChance: { none: 1, one: 0, two: 0 },
    stagingChance: 0,
    falseConfessionChance: 0,
    deliberateTamperingChance: 0,
  },
  investigator: {
    suspectCount: 5,
    witnessCount: 7,
    contaminationChance: 0.06,
    redHerringCount: 2,
    accompliceChance: { none: 0.75, one: 0.25, two: 0 },
    stagingChance: 0.2,
    falseConfessionChance: 0.03,
    deliberateTamperingChance: 0.15,
  },
  inspector: {
    suspectCount: 5,
    witnessCount: 8,
    contaminationChance: 0.09,
    redHerringCount: 3,
    accompliceChance: { none: 0.55, one: 0.35, two: 0.1 },
    stagingChance: 0.4,
    falseConfessionChance: 0.08,
    deliberateTamperingChance: 0.35,
  },
  expert: {
    suspectCount: 6,
    witnessCount: 10,
    contaminationChance: 0.12,
    redHerringCount: 4,
    accompliceChance: { none: 0.4, one: 0.4, two: 0.2 },
    stagingChance: 0.55,
    falseConfessionChance: 0.15,
    deliberateTamperingChance: 0.55,
  },
};
