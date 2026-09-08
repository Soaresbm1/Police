import type { CrimeSceneVisualDescriptor } from "../visual-manifest";
import { getLayout } from "../crime-scene-layouts";
import { hashSeed } from "../hash";

export const CRIME_SCENE_PROMPT_VERSION = 1;

const TIME_OF_DAY_PHRASE: Record<CrimeSceneVisualDescriptor["timeOfDay"], string> = {
  day: "bright natural daylight",
  evening: "warm evening lamp light against a darkening exterior",
  night: "dim nighttime lighting, mostly artificial light sources",
};

/**
 * Deterministic, server-only prompt builder for a crime-scene
 * **environment only** — never the body, never evidence, never staging
 * hints. `CrimeSceneVisualDescriptor` already contains none of that (only
 * `locationId`/`seed`/`layoutTemplate`/`timeOfDay`), so this function is
 * structurally unable to describe anything the player hasn't necessarily
 * discovered yet. Interactive evidence hotspots stay a separate,
 * deterministic overlay layer rendered on top of whatever image this
 * prompt eventually produces (see `CrimeSceneScreen.tsx`) — the image
 * model is never asked to draw, and can never invent, gameplay-relevant
 * clues (req. 9-10).
 */
export function buildCrimeSceneEnvironmentPrompt(descriptor: CrimeSceneVisualDescriptor): string {
  const layout = getLayout(descriptor.layoutTemplate);
  const lighting = TIME_OF_DAY_PHRASE[descriptor.timeOfDay];

  return (
    `Empty interior/exterior environment photograph of a ${layout.label.toLowerCase()}, unoccupied, ` +
    `no people, no bodies, no visible blood, no police tape, no evidence markers. ` +
    `${lighting}. Realistic, grounded, slightly desaturated forensic-illustration mood, ` +
    `wide establishing shot, no text, no watermark, no logos. ` +
    `The image should read as a plain, empty room or space — any story details are added separately.`
  );
}

export function crimeScenePromptHash(descriptor: CrimeSceneVisualDescriptor): number {
  return hashSeed(`${CRIME_SCENE_PROMPT_VERSION}:${buildCrimeSceneEnvironmentPrompt(descriptor)}`);
}
