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
import { mapWithConcurrency } from "./concurrency";
import { MAX_ASSETS_PER_CASE } from "./limits";

/** Pilot-scoped hard cap — deliberately tighter than the generic
 * `MAX_ASSETS_PER_CASE` (10) in `limits.ts`, which also covers manual
 * dev-inspector generations and the crime-scene kind. Only this automatic
 * trigger is bound by this number. */
export const MAX_AUTO_PORTRAITS_PER_CASE = 6;

/** Living Investigation System — Generated Art V2A. How many portrait
 * generations may be in flight at once for one case's automatic batch.
 * Bounded, never `Promise.all` over every candidate at once — 2-3 is the
 * approved conservative range; 3 divides `MAX_AUTO_PORTRAITS_PER_CASE`
 * evenly (two batches of 3) and keeps the combined burst (this + the one
 * concurrent crime-scene call, see `actions.ts`) at a small, bounded 4. */
export const PORTRAIT_GENERATION_CONCURRENCY = 3;

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
 *
 * Runs candidates with bounded concurrency (`PORTRAIT_GENERATION_CONCURRENCY`
 * at a time, via `mapWithConcurrency` — never an uncontrolled `Promise.all`
 * over every candidate). This introduces a real race that sequential
 * execution never had: `getOrGenerateAsset` checks
 * `store.countAssetsForCase` itself before creating a new row, but several
 * concurrent candidates can each read the same stale count and all decide
 * there's room, collectively overshooting `MAX_ASSETS_PER_CASE`. Fixed by
 * reading the count exactly ONCE up front and tracking a plain in-process
 * `remainingBudget` counter shared (by closure) across the concurrent
 * workers below — every check-and-decrement of it happens in a single
 * synchronous statement with no `await` in between, which is what makes it
 * safe without a lock: JS never interleaves two synchronous statements
 * within one event-loop turn, even across "concurrent" async calls. This
 * only bounds what THIS batch schedules; `getOrGenerateAsset`'s own
 * DB-level check is left completely unchanged and still guards the case
 * this batch can't see — a genuinely different process (e.g. someone
 * using the `/case-lab/art` dev inspector on this same case while this
 * batch is still running) writing to the same case concurrently. That
 * remains a narrow, low-severity residual risk (a soft cost cap, not a
 * security invariant) — see the V2A report for the full analysis of why a
 * fresh case's own seed can never collide with another `startNewCase`
 * invocation.
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

  let remainingBudget: number;
  try {
    const currentCount = await deps.store.countAssetsForCase(userId, truth.seed);
    remainingBudget = Math.max(0, MAX_ASSETS_PER_CASE - currentCount);
  } catch {
    // Pre-check-only read failed — fall back to letting each
    // getOrGenerateAsset call make its own (still-authoritative) decision,
    // exactly as if this budget guard didn't exist.
    remainingBudget = candidates.length;
  }

  await mapWithConcurrency(candidates, PORTRAIT_GENERATION_CONCURRENCY, async (person) => {
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
      return;
    }

    // Synchronous check-and-decrement, no `await` between them — see the
    // function doc comment above for why this is race-safe under
    // concurrency without needing a lock.
    if (remainingBudget <= 0) {
      diagnostics.failed++; // matches getOrGenerateAsset's own cap-reached bucketing below
      return;
    }
    remainingBudget--;

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
  });

  console.log(
    `[CASELINE] [auto-portrait] case ${truth.seed}: ` +
      `attempted=${diagnostics.attempted}, cacheHits=${diagnostics.cacheHits}, ready=${diagnostics.ready}, ` +
      `failed=${diagnostics.failed}, skippedDueToCap=${diagnostics.skippedDueToCap}.`,
  );
  return diagnostics;
}
