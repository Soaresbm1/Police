"use server";

import { revalidatePath } from "next/cache";
import { getCurrentIdentity } from "./identity";
import { getStore } from "./persistence";
import type { PlayerSettings } from "./persistence";

/** Settings live on the player's profile (not tied to any one case), so
 * this deliberately doesn't go through `withSession` — it only requires an
 * identity, never an active investigation. Reduced-motion and the hints
 * toggle are genuinely persisted here; sound stays a per-device
 * `localStorage` preference (see `SoundToggle.tsx`) since the Web Audio
 * mute check needs to run synchronously on the client with no round trip. */
export async function updateSettingsAction(patch: Partial<PlayerSettings>) {
  const { userId, authenticated } = await getCurrentIdentity();
  if (!authenticated) return;
  await getStore().updateSettings(userId, patch);
  revalidatePath("/", "layout");
}
