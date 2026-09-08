import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import type { AssetStatus, GeneratedAssetKind, GeneratedAssetRecord } from "./types";

const BUCKET = "generated-art";

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
  caseSeed: string,
  assetKind: GeneratedAssetKind,
  descriptorHash: string,
  generationVersion: number,
  provider: string,
): Promise<GeneratedAssetRecord> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("generated_assets")
    .insert({
      user_id: userId,
      case_seed: caseSeed,
      asset_kind: assetKind,
      descriptor_hash: descriptorHash,
      generation_version: generationVersion,
      provider,
      status: "queued",
    })
    .select("*")
    .single();
  if (error) throw new Error(`Supabase createQueuedRecord failed: ${error.message}`);
  return rowToRecord(data);
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
  caseSeed: string,
  assetKind: GeneratedAssetKind,
  generationVersion: number,
  provider: string,
  descriptorHashes: string[],
): Promise<GeneratedAssetRecord[]> {
  if (descriptorHashes.length === 0) return [];
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("generated_assets")
    .select("*")
    .eq("user_id", userId)
    .eq("case_seed", caseSeed)
    .eq("asset_kind", assetKind)
    .eq("generation_version", generationVersion)
    .eq("provider", provider)
    .eq("status", "ready")
    .in("descriptor_hash", descriptorHashes);
  if (error) throw new Error(`Supabase findReadyAssetsByHashes failed: ${error.message}`);
  return (data ?? []).map(rowToRecord);
}

export async function countAssetsForCase(userId: string, caseSeed: string): Promise<number> {
  const supabase = await createServerSupabaseClient();
  const { count, error } = await supabase
    .from("generated_assets")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("case_seed", caseSeed);
  if (error) throw new Error(`Supabase countAssetsForCase failed: ${error.message}`);
  return count ?? 0;
}

/** Uploads generated image bytes to the private `generated-art` bucket at
 * the standard `{userId}/{caseSeed}/{descriptorHash}.{ext}` path — the
 * leading `userId` segment is what the storage RLS policy checks (see
 * `supabase/migrations/0002_generated_assets.sql`), so this path is safe
 * to treat as stable/permanent without also needing to be secret. */
export async function uploadAssetBytes(
  userId: string,
  caseSeed: string,
  descriptorHash: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<{ path: string }> {
  const supabase = await createServerSupabaseClient();
  const ext = contentType.split("/")[1] ?? "bin";
  const path = `${userId}/${caseSeed}/${descriptorHash}.${ext}`;
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
