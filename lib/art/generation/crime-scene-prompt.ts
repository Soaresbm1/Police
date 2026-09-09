import type { CrimeSceneVisualDescriptor } from "../visual-manifest";
import { getLayout } from "../crime-scene-layouts";
import { hashSeed } from "../hash";

/** v1: a first pass, deliberately spare ("Empty interior/exterior
 * environment photograph..."). v2 (current): rewritten for the hybrid
 * crime-scene pilot — pushes for genuine documentary/lived-in realism
 * (matching the lesson already learned from character portrait v2->v3:
 * ask for an ordinary real place, not a stylized/cinematic composition),
 * adds `architectureStyle`/`weather` phrasing, and states the
 * no-decisive-evidence safety wording explicitly rather than only
 * implicitly via "no evidence markers". Bumped alongside
 * `CRIME_SCENE_GENERATION_VERSION` so no `v1` row is ever silently reused
 * under the new style (none exist yet, but the discipline matters going
 * forward the same way it did for `CHARACTER_PROMPT_VERSION`). */
export const CRIME_SCENE_PROMPT_VERSION = 2;

const TIME_OF_DAY_PHRASE: Record<CrimeSceneVisualDescriptor["timeOfDay"], string> = {
  day: "bright, ordinary daylight through the windows",
  evening: "warm interior lamp light mixed with a dim, fading exterior",
  night: "dim, mostly artificial lighting, deep shadows in the corners",
};

/** Derived only from `location.type` (see `visual-manifest.ts`'s
 * `ARCHITECTURE_BY_TYPE`) — a purely structural, guilt-safe property of
 * the building itself, never of the case. */
const ARCHITECTURE_PHRASE: Record<CrimeSceneVisualDescriptor["architectureStyle"], string> = {
  residential_modern: "a modest, ordinary modern residential building",
  residential_old: "an older, slightly worn residential building",
  commercial: "an unremarkable commercial building",
  industrial: "a plain industrial building",
  institutional: "a plain institutional building",
  hospitality: "an ordinary hospitality building",
  outdoor: "an ordinary urban street",
};

/** Only used for the genuinely open-air `"alley"` layout — every interior
 * layout ignores this entirely (see `buildCrimeSceneEnvironmentPrompt`). */
const WEATHER_PHRASE: Record<CrimeSceneVisualDescriptor["weather"], string> = {
  clear: "a clear sky",
  overcast: "an overcast, grey sky",
  light_rain: "light rain, wet pavement reflecting what light there is",
};

/** Exact wording CASELINE requires in every crime-scene prompt: the image
 * model must never be asked to render anything mechanically decisive.
 * Real, gameplay-relevant evidence is always a separate, deterministic
 * CASELINE overlay/component drawn on top of this image — never part of
 * it (see `CrimeSceneScreen.tsx#hotspots`). */
const NO_DECISIVE_EVIDENCE_CLAUSE =
  "The room must contain only ordinary environmental details and generic clutter. Do not depict weapons, blood, " +
  "bodies, police evidence markers, readable documents, fingerprints, footprints, broken objects, suspicious " +
  "objects, or any visually decisive clue. Investigative evidence is rendered separately by the game engine.";

/**
 * Deterministic, server-only prompt builder for a crime-scene
 * **environment only** — never the body, never evidence, never staging
 * hints. `CrimeSceneVisualDescriptor` is built from `GuiltSafeLocationFields`
 * (`visual-manifest.ts`) — a person's guilt, the actual culprit/accomplice,
 * staging, tampering, and every undiscovered clue are all things this
 * function has no way to see, structurally, not by convention. Interactive
 * evidence hotspots stay a separate, deterministic overlay layer rendered
 * on top of whatever image this prompt eventually produces (see
 * `CrimeSceneScreen.tsx`) — the image model is never asked to draw, and
 * can never invent, gameplay-relevant clues.
 *
 * Target style: a real, ordinary, lived-in European location police have
 * just walked into — documentary realism, not a cinematic murder-scene
 * poster. No stylization, no dramatized lighting, no horror aesthetic.
 */
export function buildCrimeSceneEnvironmentPrompt(descriptor: CrimeSceneVisualDescriptor): string {
  const layout = getLayout(descriptor.layoutTemplate);
  const lighting = TIME_OF_DAY_PHRASE[descriptor.timeOfDay];
  const architecture = ARCHITECTURE_PHRASE[descriptor.architectureStyle];
  const isOpenAir = descriptor.layoutTemplate === "alley";
  const weatherClause = isOpenAir ? ` ${WEATHER_PHRASE[descriptor.weather]}.` : "";

  return (
    `Realistic documentary photograph of an ordinary, empty ${layout.label.toLowerCase()}, part of ${architecture}, ` +
    `unoccupied, no people visible anywhere. ${lighting}.${weatherClause} ` +
    `A believable, lived-in space with ordinary everyday clutter — the kind of place real people actually use, ` +
    `neither pristine nor theatrically messy. ` +
    `Grounded fictional European setting, ordinary unremarkable architecture, restrained realistic photography, ` +
    `natural perspective, normal depth of field. ` +
    `No stylized concept-art look, no extreme noir, no dramatic horror aesthetic, no obvious AI surrealism, ` +
    `no cinematic color grading, no dramatic composition. ` +
    `${NO_DECISIVE_EVIDENCE_CLAUSE} ` +
    `No text, no logos, no watermarks, no signage with readable text.`
  );
}

export function crimeScenePromptHash(descriptor: CrimeSceneVisualDescriptor): number {
  return hashSeed(`${CRIME_SCENE_PROMPT_VERSION}:${buildCrimeSceneEnvironmentPrompt(descriptor)}`);
}
