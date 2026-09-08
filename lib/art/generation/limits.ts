/**
 * Cost/safety controls for real image generation — enforced by
 * `pipeline.ts` before ever calling a provider. See GENERATED_ART.md for
 * the reasoning behind each number; these are deliberately conservative
 * pilot-scope defaults (req. 14-15 of the generated-art brief), not tuned
 * for a chosen provider yet.
 */

/** Hard cap on distinct generated assets per case (victim + primary
 * suspects + important witnesses + one crime-scene environment ≈ 5-10). */
export const MAX_ASSETS_PER_CASE = 10;

/** After this many failed attempts for the same (descriptorHash,
 * generationVersion, provider), stop retrying automatically — a human
 * needs to look at `error_message`. */
export const MAX_GENERATION_ATTEMPTS = 3;

/** Minimum time before a `failed` asset is eligible to be retried, so a
 * flaky provider or a burst of page loads can't hammer it. */
export const FAILURE_COOLDOWN_MINUTES = 30;

/** Upper bound on how long one generation call is allowed to run before
 * the pipeline gives up and falls back to procedural art — gameplay must
 * never wait indefinitely for artwork (req. 5). */
export const GENERATION_TIMEOUT_MS = 20_000;
