import type { Difficulty } from "../types/case";

export interface DifficultyConfig {
  suspectCount: number;
  witnessCount: number;
  contaminationChance: number;
  redHerringCount: number;
}

export const DIFFICULTY_CONFIGS: Record<Difficulty, DifficultyConfig> = {
  recruit: { suspectCount: 4, witnessCount: 6, contaminationChance: 0.03, redHerringCount: 1 },
  investigator: { suspectCount: 5, witnessCount: 7, contaminationChance: 0.06, redHerringCount: 2 },
  inspector: { suspectCount: 5, witnessCount: 8, contaminationChance: 0.09, redHerringCount: 3 },
  expert: { suspectCount: 6, witnessCount: 10, contaminationChance: 0.12, redHerringCount: 4 },
};
