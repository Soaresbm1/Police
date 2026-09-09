export type GeneratedAssetKind = "character_portrait" | "crime_scene_environment";

export type AssetStatus = "missing" | "queued" | "generating" | "ready" | "failed";

/**
 * Domain shape of one `generated_assets` row (camelCase, mirrors
 * `lib/supabase/database.types.ts#generated_assets`). Deliberately carries
 * nothing from `CaseTruth` — `caseSeed` + `descriptorHash` are already
 * enough to regenerate the exact same visual descriptor deterministically.
 */
export interface GeneratedAssetRecord {
  id: string;
  userId: string;
  caseSeed: string;
  assetKind: GeneratedAssetKind;
  descriptorHash: string;
  generationVersion: number;
  provider: string;
  providerModel: string | null;
  status: AssetStatus;
  storagePath: string | null;
  width: number | null;
  height: number | null;
  promptVersion: number | null;
  errorMessage: string | null;
  attemptCount: number;
  failedAt: string | null;
  /** Generated Art V2B — the coarse, guilt-safe reuse bucket this row
   * belongs to (see `reusable-descriptor.ts`), or `null` for any row
   * created before V2B (never a reuse source or consumer). */
  reuseKey: string | null;
  /** How many times another entity's row has been created by pointing at
   * this row's `storagePath` — cosmetic bookkeeping only, never read by
   * anything gameplay-affecting. Only ever meaningful/incremented on a
   * CANONICAL row (`sourceAssetId === null`) — see `sourceAssetId`. */
  reuseCount: number;
  /** Generated Art V2B (hardening pass) — `null` for a freshly-generated
   * row (a real Cloudflare call produced it; it IS a canonical source).
   * Non-null for a reused row: the id of the CANONICAL row it copied its
   * `storagePath` from — always exactly one hop, never another reused
   * row, so no A -> B -> C chain can ever form. A reused row is never
   * itself returned as a reuse candidate (see
   * `asset-store.ts#findReusableAssetCandidates`'s `source_asset_id IS
   * NULL` filter). */
  sourceAssetId: string | null;
}
