import type { GeneratedAssetProvider } from "../generated-asset-provider";
import type { CaseTruth } from "@/lib/game-engine/types/case";
import { buildCrimeSceneVisualDescriptor } from "../visual-manifest";
import { hashDescriptor } from "../asset-cache";
import { buildCrimeSceneEnvironmentPrompt, CRIME_SCENE_PROMPT_VERSION } from "./crime-scene-prompt";
import { getOrGenerateAsset, type AssetStoreLike } from "./pipeline";
import { ACTIVE_PROVIDER_NAME, CRIME_SCENE_GENERATION_VERSION } from "./asset-kinds";
import { reuseSceneKey } from "./reusable-descriptor";

/** Hard cap for this trigger — always exactly one crime-scene environment
 * (the case's own crime location) per case, never secondary locations,
 * evidence images, CCTV, documents, maps, or additional scene angles. */
export const MAX_AUTO_CRIME_SCENES_PER_CASE = 1;

/** Generated Art V2B — how many same-user reuse candidates to fetch for
 * the one scene lookup. Only one entity is ever involved per case, so
 * same-batch collision (the concern `PORTRAIT_GENERATION_CONCURRENCY`
 * guards against) cannot happen here — this just gives a small amount of
 * headroom if the single best candidate's row somehow fails to
 * materialize (see `getOrGenerateAsset`'s per-candidate fallback). */
const REUSE_CANDIDATE_LIMIT = 3;

/** Server-only gate — never `NEXT_PUBLIC_`, checked only from Server
 * Actions/Components. A dedicated flag, deliberately independent from
 * `AUTO_GENERATED_PORTRAITS_ENABLED` (see `.env.example`) — portrait and
 * crime-scene automatic generation must be configurable in any
 * combination (both off, either alone, both on). Defaults to disabled. */
export function isAutoCrimeSceneGenerationEnabled(): boolean {
  return process.env.AUTO_GENERATED_CRIME_SCENES_ENABLED === "true";
}

export interface AutoCrimeSceneDiagnostics {
  attempted: number;
  cacheHits: number;
  ready: number;
  failed: number;
  /** 1 only in the defensive case where the case's own crime location
   * can't be found in `truth.locations` — should not happen in practice,
   * but this trigger must never throw regardless. */
  skipped: number;
  /** Generated Art V2B — 1 if the scene was served by reusing a same-user
   * asset from a different case instead of a real Cloudflare call. */
  reuseHits: number;
}

/**
 * The one automatic crime-scene-generation entry point — called from
 * `after()` in `startNewCase`, never from a render/read path, and
 * independently gated from `runAutoPortraitGeneration`
 * (`auto-portrait-trigger.ts`). Reuses the exact same production
 * pipeline and the already-approved v2 prompt unchanged: same
 * descriptor → hash → generation-version cache key, same
 * `getOrGenerateAsset`, the same active Cloudflare provider, the same
 * Supabase Storage/signed-URL path.
 *
 * Guilt-safe by construction: `buildCrimeSceneVisualDescriptor` only
 * ever reads `GuiltSafeLocationFields` (id/type) plus the crime
 * timestamp — this function never reads `culpritId`, `accompliceIds`,
 * `staging`, `tamperingEvents`, or any undiscovered-evidence field from
 * `truth`, so two cases whose hidden CaseTruth differs but whose crime
 * location/timestamp are the same always resolve to the identical
 * descriptor/prompt/cache key.
 *
 * Never throws: `getOrGenerateAsset` itself never rejects (a provider/
 * store failure resolves to `{status: "failed"}`); the one call this
 * function adds on top (`findAssetRecord`, for diagnostics only) is
 * wrapped so a transient read failure degrades to "treat as not cached"
 * rather than propagating — a Cloudflare failure here can never fail
 * case creation, which has already redirected the player by the time
 * this runs.
 */
export async function runAutoCrimeSceneGeneration(
  deps: { store: AssetStoreLike; provider: GeneratedAssetProvider },
  userId: string,
  truth: CaseTruth,
): Promise<AutoCrimeSceneDiagnostics> {
  const diagnostics: AutoCrimeSceneDiagnostics = { attempted: 0, cacheHits: 0, ready: 0, failed: 0, skipped: 0, reuseHits: 0 };

  const location = truth.locations.find((l) => l.id === truth.crimeLocationId);
  if (!location) {
    diagnostics.skipped = 1;
    logSummary(truth.seed, diagnostics);
    return diagnostics;
  }

  const descriptor = buildCrimeSceneVisualDescriptor(location, truth.crimeTimestamp);
  const descriptorHash = hashDescriptor(descriptor);

  let existing = null;
  try {
    existing = await deps.store.findAssetRecord(userId, descriptorHash, CRIME_SCENE_GENERATION_VERSION, ACTIVE_PROVIDER_NAME);
  } catch {
    // Diagnostics-only lookup — `getOrGenerateAsset` below performs its
    // own authoritative check-and-generate regardless of this result.
  }
  if (existing?.status === "ready") {
    diagnostics.cacheHits++;
    logSummary(truth.seed, diagnostics);
    return diagnostics;
  }

  diagnostics.attempted++;
  const result = await getOrGenerateAsset(
    deps,
    {
      userId,
      caseSeed: truth.seed,
      assetKind: "crime_scene_environment",
      descriptorHash,
      generationVersion: CRIME_SCENE_GENERATION_VERSION,
      providerName: ACTIVE_PROVIDER_NAME,
      promptVersion: CRIME_SCENE_PROMPT_VERSION,
      prompt: buildCrimeSceneEnvironmentPrompt(descriptor),
      seed: descriptor.seed,
      reuseKey: reuseSceneKey(descriptor),
    },
    { excludeCaseSeed: truth.seed, claimedSourceIds: new Set(), candidateLimit: REUSE_CANDIDATE_LIMIT },
  );
  if (result.status === "ready") {
    diagnostics.ready++;
    if (result.origin === "reuse") diagnostics.reuseHits++;
  } else {
    diagnostics.failed++;
  }

  logSummary(truth.seed, diagnostics);
  return diagnostics;
}

function logSummary(seed: string, d: AutoCrimeSceneDiagnostics): void {
  // Never logs the prompt, a credential, or anything CaseTruth-shaped —
  // only counts and the (already player-visible-eventually) case seed,
  // same discipline as auto-portrait-trigger.ts's own summary line.
  console.log(
    `[CASELINE] [auto-crime-scene] case ${seed}: ` +
      `attempted=${d.attempted}, cacheHits=${d.cacheHits}, ready=${d.ready}, reuseHits=${d.reuseHits}, failed=${d.failed}, skipped=${d.skipped}.`,
  );
}
