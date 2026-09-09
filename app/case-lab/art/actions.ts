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

  const result = await getOrGenerateAsset(
    { store: assetStore, provider: activeGeneratedAssetProvider },
    { userId: identity.userId, caseSeed, assetKind, descriptorHash, generationVersion, providerName: ACTIVE_PROVIDER_NAME, promptVersion, prompt, seed },
  );
  // Tagged distinctly from the automatic triggers' own summary lines
  // (auto-portrait-trigger.ts / auto-scene-trigger.ts) so dev logs can
  // tell manual clicks apart from background generation — counts and
  // status only, never the prompt or a credential.
  console.log(`[CASELINE] [manual-dev] case ${caseSeed}: assetKind=${assetKind}, result=${result.status}.`);

  revalidatePath("/case-lab/art");
}

/**
 * Manually clears a row stuck at `queued`/`generating` — the pipeline
 * deliberately never auto-retries those (to avoid piling concurrent
 * generations onto the same descriptor), so a row whose process died
 * between `markGenerating` and `markReady`/`markFailed` (a crashed dev
 * server, an uncaught exception fixed after the fact) needs an explicit
 * unstick before it can be retried. Marks it `failed` — the normal retry/
 * cooldown rules then apply to it like any other failure. Dev-only, same
 * gating as the rest of this inspector.
 */
export async function unstickAssetAction(formData: FormData): Promise<void> {
  if (process.env.NODE_ENV === "production") return;

  const identity = await getCurrentIdentity();
  if (!identity.authenticated) return;

  const descriptorHash = String(formData.get("descriptorHash") ?? "");
  const generationVersion = Number(formData.get("generationVersion") ?? 0);
  if (!descriptorHash) return;

  const record = await assetStore.findAssetRecord(identity.userId, descriptorHash, generationVersion, ACTIVE_PROVIDER_NAME);
  if (record && (record.status === "queued" || record.status === "generating")) {
    await assetStore.markFailed(identity.userId, record.id, "manually unstuck from the dev inspector", record.attemptCount);
  }

  revalidatePath("/case-lab/art");
}
