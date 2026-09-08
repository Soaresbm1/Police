import { cache } from "react";
import type { CaseTruth } from "@/lib/game-engine/types/case";
import type { PersonId } from "@/lib/game-engine/types/person";
import { buildCharacterVisualDescriptor } from "../visual-manifest";
import { hashDescriptor } from "../asset-cache";
import { importantPeopleForPortraits } from "./pilot-scope";
import * as assetStore from "./asset-store";
import { CHARACTER_PORTRAIT_GENERATION_VERSION, ACTIVE_PROVIDER_NAME } from "./asset-kinds";

/** The two store operations this lookup needs — structurally satisfied by
 * `asset-store.ts` (imported as a namespace) and by a fake in-memory
 * implementation in tests, same DI pattern as `pipeline.ts#AssetStoreLike`. */
export interface PortraitLookupDeps {
  findReadyAssetsByHashes: typeof assetStore.findReadyAssetsByHashes;
  getSignedAssetUrls: typeof assetStore.getSignedAssetUrls;
}

/**
 * The one read-only entry point gameplay pages use to find out which of
 * this case's important people already have a `ready` generated
 * portrait. Purely additive on top of the existing procedural rendering
 * path — `CharacterPortrait` falls back to procedural whenever a person
 * is absent from the returned map, which is true for every bystander/red
 * herring (never in `importantPeopleForPortraits`) and for anyone whose
 * portrait simply hasn't been generated yet.
 *
 * Structurally cannot trigger generation: it only ever calls
 * `findReadyAssetsByHashes`/`getSignedAssetUrls` (both pure reads), never
 * `getOrGenerateAsset`. Structurally guilt-safe: each descriptor is built
 * from `GuiltSafePersonFields` only (age/sex/profession/avatarSeed — see
 * `visual-manifest.ts`), so a suspect, a witness, the victim, and the
 * actual culprit all resolve through the exact same code path with no
 * branch on role anywhere in this file.
 */
export async function resolveReadyPortraitUrls(deps: PortraitLookupDeps, userId: string, truth: CaseTruth): Promise<Map<PersonId, string>> {
  const people = importantPeopleForPortraits(truth);
  if (people.length === 0) return new Map();

  const hashByPersonId = new Map<PersonId, string>();
  for (const person of people) {
    hashByPersonId.set(person.id, hashDescriptor(buildCharacterVisualDescriptor(person)));
  }

  let records;
  try {
    records = await deps.findReadyAssetsByHashes(
      userId,
      truth.seed,
      "character_portrait",
      CHARACTER_PORTRAIT_GENERATION_VERSION,
      ACTIVE_PROVIDER_NAME,
      [...hashByPersonId.values()],
    );
  } catch {
    // A Supabase outage here must never break a gameplay page — degrade
    // to "nothing ready", i.e. every portrait falls back to procedural.
    return new Map();
  }

  const pathByHash = new Map<string, string>();
  for (const record of records) {
    if (record.storagePath) pathByHash.set(record.descriptorHash, record.storagePath);
  }
  if (pathByHash.size === 0) return new Map();

  const urlByPath = await deps.getSignedAssetUrls([...pathByHash.values()]).catch(() => new Map<string, string>());

  const result = new Map<PersonId, string>();
  for (const [personId, hash] of hashByPersonId) {
    const path = pathByHash.get(hash);
    const url = path ? urlByPath.get(path) : undefined;
    if (url) result.set(personId, url);
  }
  return result;
}

/**
 * The real, `cache()`-wrapped entry point pages call — backed by the
 * actual Supabase-backed `asset-store.ts` functions. `cache()` dedupes
 * repeated calls with the same `(userId, truth)` reference within one
 * request/page, so multiple components rendering off the same
 * `getCurrentGame()` result share a single batched read instead of each
 * re-querying.
 */
export const getReadyPortraitUrls = cache((userId: string, truth: CaseTruth): Promise<Map<PersonId, string>> =>
  resolveReadyPortraitUrls(assetStore, userId, truth),
);
