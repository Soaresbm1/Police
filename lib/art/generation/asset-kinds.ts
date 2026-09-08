/**
 * Overall generation-policy versions — part of the "generate once"
 * uniqueness key alongside `descriptorHash`/`provider` (see
 * `pipeline.ts#getOrGenerateAsset`). Distinct from a prompt's own
 * `PROMPT_VERSION` (`character-prompt.ts`/`crime-scene-prompt.ts`):
 * bumping this forces regeneration even if the prompt text is unchanged
 * (e.g. after a provider/model swap), while `PROMPT_VERSION` is stored
 * for reproducibility/debugging only and isn't part of the cache key.
 */
// Bumped alongside CHARACTER_PROMPT_VERSION each time the prompt style
// changes meaningfully (1 -> 2: corporate/LinkedIn-headshot look replaced
// by documentary/administrative-photo style; 2 -> 3: removed remaining
// flattering-light/bokeh/overly-clean-face professional-portrait cues,
// wired in skinTone). A "ready" row from an older version (e.g. Vincent
// Charrière's v1 portrait, Delphine Berger's v2 portrait) is deliberately
// NOT reused under a newer version — it would silently mix visual styles.
export const CHARACTER_PORTRAIT_GENERATION_VERSION = 3;
export const CRIME_SCENE_GENERATION_VERSION = 1;

/** The provider name recorded on every `generated_assets` row — the
 * pilot's only real provider. A row only ever reaches `status: "ready"`
 * when this provider's `generate()` actually succeeded, so the label
 * stays accurate even while `activeGeneratedAssetProvider` resolves to
 * the null provider (missing credentials): nothing is ever marked ready
 * without a real Cloudflare response. */
export const ACTIVE_PROVIDER_NAME = "cloudflare";
