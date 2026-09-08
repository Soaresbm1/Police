import type { CharacterVisualDescriptor } from "../visual-manifest";
import { hashSeed } from "../hash";

/** Bump when the prompt template itself changes meaningfully — stored
 * alongside each generated asset so a future style change can be applied
 * deliberately (regenerate only rows with an old `prompt_version`) rather
 * than silently mixing old and new art (req. 8, 13). */
export const CHARACTER_PROMPT_VERSION = 1;

const AGE_PHRASE: Record<CharacterVisualDescriptor["approxAge"], string> = {
  young: "in their late twenties",
  middle: "in their forties",
  older: "in their sixties",
};

const PRESENTATION_PHRASE: Record<CharacterVisualDescriptor["presentation"], string> = {
  masculine: "man",
  feminine: "woman",
};

const HAIRSTYLE_PHRASE: Record<CharacterVisualDescriptor["hairstyle"], string> = {
  short: "short hair",
  buzz: "a buzz cut",
  shoulder: "shoulder-length hair",
  long: "long hair",
  bald: "a shaved head",
  bun: "hair tied back in a bun",
  curly: "curly hair",
  ponytail: "hair in a ponytail",
};

const FACE_SHAPE_PHRASE: Record<CharacterVisualDescriptor["faceShape"], string> = {
  oval: "an oval face",
  square: "a square jaw",
  round: "a round face",
  angular: "angular features",
};

const CLOTHING_PHRASE: Record<CharacterVisualDescriptor["clothingCategory"], string> = {
  casual: "plain casual clothing",
  formal: "a simple dark suit or formal wear",
  workwear: "practical workwear",
  uniform: "a neutral, non-branded uniform",
  sport: "simple athletic wear",
};

/** The fixed hair-color palette in `visual-manifest.ts` mapped to plain
 * words — kept here (not in visual-manifest.ts) since it's presentation
 * vocabulary for a prompt, not a visual-fact the renderer needs. */
const HAIR_COLOR_WORD: Record<string, string> = {
  "#2b2420": "black",
  "#4a3728": "dark brown",
  "#6b4a2f": "brown",
  "#8a6b45": "light brown",
  "#3d3d3d": "dark grey",
  "#c9c2b0": "grey",
  "#1a1714": "near-black",
};

const FRAMING_PHRASE: Record<CharacterVisualDescriptor["framing"], string> = {
  front: "facing the camera directly",
  three_quarter: "in a three-quarter view",
};

/**
 * Deterministic, server-only prompt builder. Takes *only*
 * `CharacterVisualDescriptor` — the same guilt-safety guarantee that type
 * already carries (built from `Person` fields alone, never `CaseTruth`)
 * means this function has no way to leak culprit/accomplice/motive status
 * into a prompt, structurally, not by convention. Never interpolates the
 * descriptor's own `personId` or any name/profession text — only the
 * abstracted visual traits.
 */
export function buildCharacterPortraitPrompt(descriptor: CharacterVisualDescriptor): string {
  const subject = `${AGE_PHRASE[descriptor.approxAge]} ${PRESENTATION_PHRASE[descriptor.presentation]}`;
  const hairColor = HAIR_COLOR_WORD[descriptor.hairColor] ?? "neutral-toned";
  const hair = `${hairColor} ${HAIRSTYLE_PHRASE[descriptor.hairstyle]}`;
  const face = FACE_SHAPE_PHRASE[descriptor.faceShape];
  const clothing = CLOTHING_PHRASE[descriptor.clothingCategory];
  const framing = FRAMING_PHRASE[descriptor.framing];

  return (
    `Grounded fictional European police dossier photograph of a ${subject}, ${face}, ${hair}. ` +
    `Wearing ${clothing}. Neutral expression, ${framing}, head-and-shoulders framing, ` +
    `even studio lighting, plain neutral grey police-record background. ` +
    `Realistic but clearly fictional person — cinematic realism without glamour, no stylization, ` +
    `no text, no watermark, no logos.`
  );
}

export function characterPromptHash(descriptor: CharacterVisualDescriptor): number {
  return hashSeed(`${CHARACTER_PROMPT_VERSION}:${buildCharacterPortraitPrompt(descriptor)}`);
}
