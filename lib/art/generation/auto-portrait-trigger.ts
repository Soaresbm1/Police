import type { GeneratedAssetProvider } from "../generated-asset-provider";
import type { CaseTruth } from "@/lib/game-engine/types/case";
import type { Person } from "@/lib/game-engine/types/person";
import { buildCharacterVisualDescriptor } from "../visual-manifest";
import { hashDescriptor } from "../asset-cache";
import { hashSeed } from "../hash";
import { buildCharacterPortraitPrompt, CHARACTER_PROMPT_VERSION } from "./character-prompt";
import { getOrGenerateAsset, type AssetStoreLike } from "./pipeline";
import { ACTIVE_PROVIDER_NAME, CHARACTER_PORTRAIT_GENERATION_VERSION } from "./asset-kinds";
import { importantPeopleForPortraits } from "./pilot-scope";

/** Pilot-scoped hard cap — deliberately tighter than the generic
 * `MAX_ASSETS_PER_CASE` (10) in `limits.ts`, which also covers manual
 * dev-inspector generations and the not-yet-built crime-scene kind. Only
 * this automatic trigger is bound by this number. */
export const MAX_AUTO_PORTRAITS_PER_CASE = 6;

/** Server-only gate — never `NEXT_PUBLIC_`, checked only from Server
 * Actions/Components. Defaults to disabled (see `.env.example`); automatic
 * generation is a deliberate, explicitly-enabled pilot, never the default
 * for anyone who happens to have Cloudflare configured. */
export function isAutoPortraitGenerationEnabled(): boolean {
  return process.env.AUTO_GENERATED_PORTRAITS_ENABLED === "true";
}

/**
 * Deterministic, guilt-safe selection of who gets an automatically
 * generated portrait: the victim, then every primary suspect, then the
 * remaining important witnesses ranked by a pure hash of
 * (case seed, personId) — capped at `cap`. Priority order alone means
 * victim + suspects always win any remaining witness slots once the cap
 * is reached, matching "primary suspects before witnesses".
 *
 * Guilt-safety: this function never reads `culpritId`, `accompliceIds`,
 * `motive`, `testimony`, `staging`, or any other CaseTruth field that
 * could correlate with who actually did it or who is lying — only
 * `victimId`, `suspectIds` (a list of several people, the actual culprit
 * among them with no marker distinguishing them), `redHerringPersonIds`,
 * and each person's own `roles`/`id`. The witness tie-break hash is keyed
 * on the person's own id and the case seed, nothing hidden — identical in
 * spirit to `buildCharacterVisualDescriptor`'s own guilt-safety guarantee.
 */
export function selectAutoPortraitCandidates(truth: CaseTruth, cap: number = MAX_AUTO_PORTRAITS_PER_CASE): Person[] {
  const victim = truth.people.find((p) => p.id === truth.victimId);
  const suspects = truth.people.filter((p) => truth.suspectIds.includes(p.id));
  const witnesses = truth.people.filter(
    (p) => p.roles.includes("witness") && !truth.redHerringPersonIds.includes(p.id) && p.id !== truth.victimId && !truth.suspectIds.includes(p.id),
  );
  const rankedWitnesses = [...witnesses].sort(
    (a, b) => hashSeed(`${truth.seed}:auto-portrait-rank:${a.id}`) - hashSeed(`${truth.seed}:auto-portrait-rank:${b.id}`),
  );

  const ordered = [...(victim ? [victim] : []), ...suspects, ...rankedWitnesses];
  return ordered.slice(0, cap);
}

export interface AutoPortraitDiagnostics {
  attempted: number;
  cacheHits: number;
  ready: number;
  failed: number;
  skippedDueToCap: number;
}

/**
 * The one automatic-generation entry point — called from `after()` in
 * `startNewCase`, never from a render/read path. Reuses the exact same
 * production pipeline the manual dev-inspector trigger uses: same
 * descriptor → hash → generation-version cache key, same
 * `getOrGenerateAsset` (so "generate once" and the existing timeout/retry/
 * cooldown/per-case-cap controls in `limits.ts` all apply unchanged), the
 * same active Cloudflare provider, the same Supabase Storage/signed-URL
 * path. Runs strictly sequentially — never `Promise.all` — one real HTTP
 * call in flight at a time, conservative by design.
 *
 * Never throws: every per-person failure is already contained by
 * `getOrGenerateAsset` itself (a provider/store failure there resolves to
 * `{status: "failed"}`, it never rejects); the one call this function adds
 * on top (`findAssetRecord`, for diagnostics only) is wrapped so a
 * transient read failure degrades to "treat as not cached" rather than
 * propagating.
 *
 * `deps` follows the exact same shape `getOrGenerateAsset` itself takes
 * (`AssetStoreLike` + `GeneratedAssetProvider`) — the real call site
 * (`startNewCase`) passes the real `asset-store.ts` module and
 * `activeGeneratedAssetProvider`; tests pass a fake store/provider, the
 * same DI pattern `pipeline.test.ts` already uses, no Supabase/Cloudflare
 * mocking required.
 */
export async function runAutoPortraitGeneration(
  deps: { store: AssetStoreLike; provider: GeneratedAssetProvider },
  userId: string,
  truth: CaseTruth,
): Promise<AutoPortraitDiagnostics> {
  const allImportant = importantPeopleForPortraits(truth);
  const candidates = selectAutoPortraitCandidates(truth);
  const diagnostics: AutoPortraitDiagnostics = {
    attempted: 0,
    cacheHits: 0,
    ready: 0,
    failed: 0,
    skippedDueToCap: Math.max(0, allImportant.length - candidates.length),
  };

  for (const person of candidates) {
    const descriptor = buildCharacterVisualDescriptor(person);
    const descriptorHash = hashDescriptor(descriptor);

    let existing = null;
    try {
      existing = await deps.store.findAssetRecord(userId, descriptorHash, CHARACTER_PORTRAIT_GENERATION_VERSION, ACTIVE_PROVIDER_NAME);
    } catch {
      // Diagnostics-only lookup — `getOrGenerateAsset` below performs its
      // own authoritative check-and-generate regardless of this result.
    }
    if (existing?.status === "ready") {
      diagnostics.cacheHits++;
      continue;
    }

    diagnostics.attempted++;
    const result = await getOrGenerateAsset(deps, {
      userId,
      caseSeed: truth.seed,
      assetKind: "character_portrait",
      descriptorHash,
      generationVersion: CHARACTER_PORTRAIT_GENERATION_VERSION,
      providerName: ACTIVE_PROVIDER_NAME,
      promptVersion: CHARACTER_PROMPT_VERSION,
      prompt: buildCharacterPortraitPrompt(descriptor),
      seed: descriptor.seed,
    });
    if (result.status === "ready") diagnostics.ready++;
    else diagnostics.failed++;
  }

  console.log(
    `[CASELINE] Automatic portrait generation for case ${truth.seed}: ` +
      `attempted=${diagnostics.attempted}, cacheHits=${diagnostics.cacheHits}, ready=${diagnostics.ready}, ` +
      `failed=${diagnostics.failed}, skippedDueToCap=${diagnostics.skippedDueToCap}.`,
  );
  return diagnostics;
}
