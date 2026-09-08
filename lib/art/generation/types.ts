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
}
