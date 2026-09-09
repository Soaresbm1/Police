import { cache } from "react";
import { hashDescriptor } from "../asset-cache";
import type { CrimeSceneVisualDescriptor } from "../visual-manifest";
import * as assetStore from "./asset-store";
import { ACTIVE_PROVIDER_NAME, CRIME_SCENE_GENERATION_VERSION } from "./asset-kinds";

/** The two store operations this lookup needs — same DI pattern as
 * `portrait-lookup.ts#PortraitLookupDeps`, structurally satisfied by
 * `asset-store.ts` (imported as a namespace) and by a fake in-memory
 * implementation in tests. */
export interface SceneLookupDeps {
  findAssetRecord: typeof assetStore.findAssetRecord;
  getSignedAssetUrl: typeof assetStore.getSignedAssetUrl;
}

/**
 * The one read-only entry point the crime-scene screen uses to find out
 * whether a `ready` generated environment already exists for this case's
 * crime scene. Purely additive on top of the existing procedural SVG
 * background — `CrimeSceneScreen` falls back to procedural whenever this
 * resolves to `null`, which is true until a real generation has actually
 * succeeded for this exact descriptor.
 *
 * Structurally cannot trigger generation: it only ever calls
 * `findAssetRecord`/`getSignedAssetUrl` (both pure reads), never
 * `getOrGenerateAsset`. Structurally guilt-safe: `descriptor` is built by
 * the caller from `GuiltSafeLocationFields` only (see
 * `visual-manifest.ts#buildCrimeSceneVisualDescriptor`) — this function
 * never sees `CaseTruth` at all.
 */
export async function resolveReadySceneUrl(deps: SceneLookupDeps, userId: string, descriptor: CrimeSceneVisualDescriptor): Promise<string | null> {
  const descriptorHash = hashDescriptor(descriptor);

  let record;
  try {
    record = await deps.findAssetRecord(userId, descriptorHash, CRIME_SCENE_GENERATION_VERSION, ACTIVE_PROVIDER_NAME);
  } catch {
    // A Supabase outage here must never break the crime-scene screen —
    // degrade to "nothing ready", i.e. the procedural background stays.
    return null;
  }
  if (record?.status !== "ready" || !record.storagePath) return null;

  return deps.getSignedAssetUrl(record.storagePath).catch(() => null);
}

/**
 * The real, `cache()`-wrapped entry point the scene page calls — backed by
 * the actual Supabase-backed `asset-store.ts` functions. `cache()` dedupes
 * repeated calls with the same `(userId, descriptor)` reference within one
 * request/page.
 */
export const getReadyCrimeSceneUrl = cache((userId: string, descriptor: CrimeSceneVisualDescriptor): Promise<string | null> =>
  resolveReadySceneUrl(assetStore, userId, descriptor),
);
