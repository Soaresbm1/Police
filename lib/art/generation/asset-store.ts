import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { isCaseRef } from "@/lib/security/case-ref";
import type { AssetStatus, GeneratedAssetKind, GeneratedAssetRecord } from "./types";

const BUCKET = "generated-art";

/** Security S1 — every NEW row and object is keyed by the opaque `caseRef`,
 * never by a seed (the column keeps its historical `case_seed` name to
 * avoid a schema migration; see SECURITY.md). Refusing anything else here
 * makes a plaintext seed structurally impossible to write. */
function assertWritableCaseKey(caseKey: string): void {
  if (!isCaseRef(caseKey)) throw new Error("generated asset writes require a caseRef case key");
}

/** PostgREST `in` list literal for `.not(column, "in", …)`. Case keys are
 * `cr1_<hex>` or legacy `CASE-XXXXXX`, but quote defensively anyway. */
function postgrestInList(values: string[]): string {
  return `(${values.map((v) => `"${v.replace(/["\\]/g, "")}"`).join(",")})`;
}

type AssetRow = Database["public"]["Tables"]["generated_assets"]["Row"];

function rowToRecord(row: AssetRow): GeneratedAssetRecord {
  return {
    id: row.id,
    userId: row.user_id,
    caseSeed: row.case_seed,
    assetKind: row.asset_kind as GeneratedAssetKind,
    descriptorHash: row.descriptor_hash,
    generationVersion: row.generation_version,
    provider: row.provider,
    providerModel: row.provider_model,
    status: row.status as AssetStatus,
    storagePath: row.storage_path,
    width: row.width,
    height: row.height,
    promptVersion: row.prompt_version,
    errorMessage: row.error_message,
    attemptCount: row.attempt_count,
    failedAt: row.failed_at,
    reuseKey: row.reuse_key,
    reuseCount: row.reuse_count,
    sourceAssetId: row.source_asset_id,
  };
}

/**
 * Supabase-backed reads/writes for `generated_assets` — the durable half
 * of the descriptor→asset cache (`lib/art/asset-cache.ts` remains the
 * fast, per-process in-memory layer on top of this). Every function here
 * requires `userId` and filters by it explicitly in the query, in
 * addition to RLS (defense in depth, matching `supabase-store.ts`'s
 * existing house style) — there is structurally no way to look up another
 * user's asset through this module.
 *
 * Runs inside a normal user-authenticated request (Server Action/Route
 * Handler) using the same request-scoped, RLS-respecting client every
 * other persistence path in this project uses — see ARCHITECTURE.md:
 * there is no service-role client anywhere in this codebase, by design,
 * and this module does not introduce one.
 */

export async function findAssetRecord(
  userId: string,
  descriptorHash: string,
  generationVersion: number,
  provider: string,
): Promise<GeneratedAssetRecord | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("generated_assets")
    .select("*")
    .eq("user_id", userId)
    .eq("descriptor_hash", descriptorHash)
    .eq("generation_version", generationVersion)
    .eq("provider", provider)
    .maybeSingle();
  if (error) throw new Error(`Supabase findAssetRecord failed: ${error.message}`);
  return data ? rowToRecord(data) : null;
}

export async function createQueuedRecord(
  userId: string,
  caseRef: string,
  assetKind: GeneratedAssetKind,
  descriptorHash: string,
  generationVersion: number,
  provider: string,
  /** Generated Art V2B — tags this row with its coarse reuse bucket so a
   * FUTURE case's own lookup can find and reuse it once it's `ready`.
   * `null` for a caller that doesn't want this asset to ever become a
   * reuse source (e.g. the manual `/case-lab/art` dev inspector, which
   * deliberately never passes one). */
  reuseKey: string | null,
): Promise<GeneratedAssetRecord> {
  assertWritableCaseKey(caseRef);
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("generated_assets")
    .insert({
      user_id: userId,
      case_seed: caseRef,
      asset_kind: assetKind,
      descriptor_hash: descriptorHash,
      generation_version: generationVersion,
      provider,
      status: "queued",
      reuse_key: reuseKey,
      // A freshly-generated row is always canonical — see the
      // source_asset_id doc comment on GeneratedAssetRecord.
      source_asset_id: null,
    })
    .select("*")
    .single();
  if (error) throw new Error(`Supabase createQueuedRecord failed: ${error.message}`);
  return rowToRecord(data);
}

/**
 * Generated Art V2B — read-only lookup for same-user reuse candidates.
 * Only ever returns `ready`, CANONICAL rows (`source_asset_id IS NULL` —
 * a reused row can never itself become a future reuse source, which is
 * what makes reuse chains structurally impossible: every reused row is
 * always exactly one hop from a canonical row) whose `reuse_key` matches,
 * explicitly excluding the case currently being generated for
 * (`excludeCaseSeed`) — the hard guarantee that two entities in the SAME
 * case can never resolve to each other's asset. Ordered so the caller's
 * own same-batch claiming (see `auto-portrait-trigger.ts`) can walk down
 * the list deterministically if an earlier candidate is already claimed
 * by a concurrent sibling. `user_id` is filtered explicitly here — same
 * defense-in-depth discipline as every other function in this file — on
 * top of the unchanged RLS select policy.
 *
 * Security S1: `excludeCaseKeys` holds every key the current case may be
 * stored under (its caseRef, plus its legacy seed for a pre-S1 case).
 */
export async function findReusableAssetCandidates(
  userId: string,
  assetKind: GeneratedAssetKind,
  generationVersion: number,
  provider: string,
  reuseKey: string,
  excludeCaseKeys: string[],
  limit: number,
): Promise<GeneratedAssetRecord[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("generated_assets")
    .select("*")
    .eq("user_id", userId)
    .eq("asset_kind", assetKind)
    .eq("generation_version", generationVersion)
    .eq("provider", provider)
    .eq("reuse_key", reuseKey)
    .eq("status", "ready")
    .is("source_asset_id", null)
    .not("case_seed", "in", postgrestInList(excludeCaseKeys))
    .order("reuse_count", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`Supabase findReusableAssetCandidates failed: ${error.message}`);
  return (data ?? []).map(rowToRecord);
}

/**
 * Generated Art V2B — materializes a reuse hit as a brand-new row for the
 * CURRENT entity's own exact `descriptorHash`/`caseSeed`, `ready`
 * immediately, pointing at the SAME `storage_path` (and provider/model/
 * dimensions/prompt-version metadata) as `source` — no upload, no
 * Cloudflare call. This is what lets the existing exact-cache read path
 * (`findAssetRecord`/`findReadyAssetsByHashes`) keep working completely
 * unmodified: every entity, reused or freshly generated, always has its
 * own row keyed by its own exact descriptor hash.
 *
 * `canonicalSourceId` is set as this new row's `source_asset_id` — passed
 * explicitly by the caller (`pipeline.ts`) rather than derived from
 * `source.id` here, because the caller defensively resolves it as
 * `source.sourceAssetId ?? source.id` first. That resolution is what
 * guarantees no reuse chain can form even in the hypothetical case a
 * non-canonical row somehow reached this function despite
 * `findReusableAssetCandidates`'s own filter — this function trusts
 * whatever id it's given and never re-derives one from `source` itself.
 */
export async function createReusedRecord(
  userId: string,
  caseRef: string,
  assetKind: GeneratedAssetKind,
  descriptorHash: string,
  generationVersion: number,
  provider: string,
  source: GeneratedAssetRecord,
  reuseKey: string,
  canonicalSourceId: string,
): Promise<GeneratedAssetRecord> {
  assertWritableCaseKey(caseRef);
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("generated_assets")
    .insert({
      user_id: userId,
      case_seed: caseRef,
      asset_kind: assetKind,
      descriptor_hash: descriptorHash,
      generation_version: generationVersion,
      provider,
      provider_model: source.providerModel,
      status: "ready",
      storage_path: source.storagePath,
      width: source.width,
      height: source.height,
      prompt_version: source.promptVersion,
      reuse_key: reuseKey,
      source_asset_id: canonicalSourceId,
    })
    .select("*")
    .single();
  if (error) throw new Error(`Supabase createReusedRecord failed: ${error.message}`);
  return rowToRecord(data);
}

/** Generated Art V2B — atomic (DB-side, single UPDATE statement) increment
 * of a reuse source's `reuse_count`, via the `increment_reuse_count` SQL
 * function (migration 0004) — never a JS-side read-then-write, which
 * would lose updates under V2A's concurrent portrait generation or two
 * cases being created around the same time. Runs as the calling user
 * (`security invoker`), so the existing RLS update policy still applies;
 * `userId` is passed through as defense in depth on top of that. */
export async function incrementReuseCount(userId: string, assetId: string): Promise<void> {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("increment_reuse_count", { asset_id: assetId, owner_id: userId });
  if (error) throw new Error(`Supabase incrementReuseCount failed: ${error.message}`);
}

export async function markGenerating(userId: string, id: string): Promise<void> {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("generated_assets")
    .update({ status: "generating", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw new Error(`Supabase markGenerating failed: ${error.message}`);
}

export async function markReady(
  userId: string,
  id: string,
  fields: { storagePath: string; width: number; height: number; providerModel: string; promptVersion: number },
): Promise<void> {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("generated_assets")
    .update({
      status: "ready",
      storage_path: fields.storagePath,
      width: fields.width,
      height: fields.height,
      provider_model: fields.providerModel,
      prompt_version: fields.promptVersion,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw new Error(`Supabase markReady failed: ${error.message}`);
}

export async function markFailed(userId: string, id: string, errorMessage: string, attemptCount: number): Promise<void> {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("generated_assets")
    .update({
      status: "failed",
      error_message: errorMessage,
      attempt_count: attemptCount,
      failed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw new Error(`Supabase markFailed failed: ${error.message}`);
}

/**
 * Batched read for gameplay display: one query for every descriptor hash
 * a page cares about, instead of one query per person (the N+1 a naive
 * per-avatar lookup would cause on a suspect/witness list). Only ever
 * returns `ready` rows — this is a pure read path with no way to trigger
 * generation, so "never regenerate an existing ready asset" and "never
 * block gameplay" both hold by construction: a missing/queued/failed
 * asset simply isn't in the result, and the caller falls back to
 * procedural art immediately.
 */
export async function findReadyAssetsByHashes(
  userId: string,
  caseKeys: string[],
  assetKind: GeneratedAssetKind,
  generationVersion: number,
  provider: string,
  descriptorHashes: string[],
): Promise<GeneratedAssetRecord[]> {
  if (descriptorHashes.length === 0 || caseKeys.length === 0) return [];
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("generated_assets")
    .select("*")
    .eq("user_id", userId)
    .in("case_seed", caseKeys)
    .eq("asset_kind", assetKind)
    .eq("generation_version", generationVersion)
    .eq("provider", provider)
    .eq("status", "ready")
    .in("descriptor_hash", descriptorHashes);
  if (error) throw new Error(`Supabase findReadyAssetsByHashes failed: ${error.message}`);
  return (data ?? []).map(rowToRecord);
}

export async function countAssetsForCase(userId: string, caseKeys: string[]): Promise<number> {
  if (caseKeys.length === 0) return 0;
  const supabase = await createServerSupabaseClient();
  const { count, error } = await supabase
    .from("generated_assets")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .in("case_seed", caseKeys);
  if (error) throw new Error(`Supabase countAssetsForCase failed: ${error.message}`);
  return count ?? 0;
}

/** Uploads generated image bytes to the private `generated-art` bucket at
 * `{userId}/{caseRef}/{descriptorHash}.{ext}` — the leading `userId`
 * segment is what the storage RLS policy checks (see
 * `supabase/migrations/0002_generated_assets.sql`). Security S1: the second
 * segment is the opaque caseRef because this path is visible inside every
 * signed image URL; before S1 it was the plaintext seed. */
export async function uploadAssetBytes(
  userId: string,
  caseRef: string,
  descriptorHash: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<{ path: string }> {
  assertWritableCaseKey(caseRef);
  const supabase = await createServerSupabaseClient();
  const ext = contentType.split("/")[1] ?? "bin";
  const path = `${userId}/${caseRef}/${descriptorHash}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true });
  if (error) throw new Error(`Supabase uploadAssetBytes failed: ${error.message}`);
  return { path };
}

/** Private bucket — every read goes through a short-lived signed URL
 * created on behalf of the requesting user, never a permanently-public
 * link. Returns `null` (not a throw) on failure so a rendering caller can
 * fall back to procedural art the same way a missing/failed asset would. */
export async function getSignedAssetUrl(path: string, expiresInSeconds = 3600): Promise<string | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresInSeconds);
  if (error || !data) return null;
  return data.signedUrl;
}

/** Bulk counterpart to `getSignedAssetUrl` — one Storage call for every
 * path a page needs instead of one per row, used together with
 * `findReadyAssetsByHashes` for gameplay display. Paths that fail to sign
 * (e.g. the underlying object was somehow removed) are simply absent from
 * the returned map rather than throwing — same "degrade to procedural,
 * never break the page" contract as the single-path version. Default TTL
 * is longer than the dev-inspector's (4h vs. 1h): a gameplay page is
 * meant to stay readable for a normal play session between navigations,
 * not just one dev-tool lookup. */
export async function getSignedAssetUrls(paths: string[], expiresInSeconds = 14_400): Promise<Map<string, string>> {
  if (paths.length === 0) return new Map();
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, expiresInSeconds);
  if (error || !data) return new Map();
  const result = new Map<string, string>();
  for (const entry of data) {
    if (entry.path && entry.signedUrl && !entry.error) result.set(entry.path, entry.signedUrl);
  }
  return result;
}

// ---------------------------------------------------------------------
// Security S1 — operations for `legacy-case-migration.ts` (structurally
// satisfies its `LegacyArtMigrationOps`). Same explicit `user_id` filtering
// as everything above, on top of the unchanged RLS policies. Nothing here
// deletes a row or an object: `move` renames an object in place, and a
// path is only ever repointed for rows owned by the same user.
// ---------------------------------------------------------------------

export async function listCaseRows(userId: string, caseKey: string): Promise<{ id: string; storagePath: string | null }[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.from("generated_assets").select("id, storage_path").eq("user_id", userId).eq("case_seed", caseKey);
  if (error) throw new Error(`Supabase listCaseRows failed: ${error.message}`);
  return (data ?? []).map((row) => ({ id: row.id, storagePath: row.storage_path }));
}

export async function moveObject(fromPath: string, toPath: string): Promise<boolean> {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.storage.from(BUCKET).move(fromPath, toPath);
  return !error;
}

export async function objectExists(path: string): Promise<boolean> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.storage.from(BUCKET).exists(path);
  return !error && data === true;
}

export async function repointStoragePath(userId: string, fromPath: string, toPath: string): Promise<void> {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("generated_assets")
    .update({ storage_path: toPath })
    .eq("user_id", userId)
    .eq("storage_path", fromPath);
  if (error) throw new Error(`Supabase repointStoragePath failed: ${error.message}`);
}

export async function relabelRow(userId: string, id: string, fromCaseKey: string, toCaseKey: string): Promise<void> {
  assertWritableCaseKey(toCaseKey);
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("generated_assets")
    .update({ case_seed: toCaseKey })
    .eq("user_id", userId)
    .eq("id", id)
    .eq("case_seed", fromCaseKey);
  if (error) throw new Error(`Supabase relabelRow failed: ${error.message}`);
}
