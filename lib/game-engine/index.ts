// Server-only entry point for the case-generation engine. CaseTruth objects
// produced here must never be sent to the browser as-is — see
// docs/CASE_GENERATION.md and types/case.ts#toCaseBriefing.
export * from "./types";
export { createRootRng, generateCaseSeed, isValidCaseSeed, RNG } from "./random/rng";
export { generateCase, type GenerateCaseOptions } from "./case-generator/case-truth";
export { generateBatch, type BatchSummary, type BatchCaseResult } from "./case-generator/generate-batch";
export { validateCase, type ValidationResult } from "./validator/case-validator";
export { computeSolvability, MIN_INDEPENDENT_CHANNELS, type SolvabilityResult } from "./validator/solvability";
export { DIFFICULTY_CONFIGS, type DifficultyConfig } from "./case-generator/difficulty";
export { TemplateNarrativeProvider, type NarrativeProvider, type EmotionalState } from "./narrative/narrative-provider";
