"use server";

import { revalidatePath } from "next/cache";
import { getCurrentIdentity } from "@/lib/game-session/identity";
import { getOrGenerateAsset } from "@/lib/art/generation/pipeline";
import * as assetStore from "@/lib/art/generation/asset-store";
import { activeGeneratedAssetProvider } from "@/lib/art/generation/active-provider";
import { ACTIVE_PROVIDER_NAME } from "@/lib/art/generation/asset-kinds";
import type { GeneratedAssetKind } from "@/lib/art/generation/types";

/**
 * Manual, one-asset-at-a-time trigger for the dev-only art inspector
 * (`/case-lab/art`) — the only place in CASELINE that calls
 * `getOrGenerateAsset()` with the real `activeGeneratedAssetProvider` as
 * of this milestone. Never runs in production, never runs unattended:
 * every real generation call this pipeline can make happens because a
 * developer clicked a specific button for a specific asset.
 */
export async function triggerAssetGenerationAction(formData: FormData): Promise<void> {
  if (process.env.NODE_ENV === "production") return;

  const identity = await getCurrentIdentity();
  if (!identity.authenticated) return;

  const caseSeed = String(formData.get("caseSeed") ?? "");
  const assetKind = String(formData.get("assetKind") ?? "") as GeneratedAssetKind;
  const descriptorHash = String(formData.get("descriptorHash") ?? "");
  const generationVersion = Number(formData.get("generationVersion") ?? 0);
  const promptVersion = Number(formData.get("promptVersion") ?? 0);
  const prompt = String(formData.get("prompt") ?? "");
  const seed = String(formData.get("seed") ?? "");
  if (!caseSeed || !descriptorHash || !prompt || !seed) return;

  await getOrGenerateAsset(
    { store: assetStore, provider: activeGeneratedAssetProvider },
    { userId: identity.userId, caseSeed, assetKind, descriptorHash, generationVersion, providerName: ACTIVE_PROVIDER_NAME, promptVersion, prompt, seed },
  );

  revalidatePath("/case-lab/art");
}
