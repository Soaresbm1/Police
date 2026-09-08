import type { CharacterVisualDescriptor } from "../visual-manifest";
import { hashSeed } from "../hash";

/** Bump when the prompt template itself changes meaningfully — stored
 * alongside each generated asset so a future style change can be applied
 * deliberately (regenerate only rows with an old `prompt_version`) rather
 * than silently mixing old and new art (req. 8, 13).
 *
 * v2: moved away from a "police dossier photograph" framing, which
 * FLUX.1 [schnell] rendered as a polished corporate/LinkedIn studio
 * headshot (impeccable suit, studio lighting, glassy-smooth skin, glamour
 * framing) — the opposite of what a real administrative record photo
 * looks like. Asked for documentary/administrative realism instead:
 * ordinary clothing, flat practical lighting, real skin texture, mild
 * asymmetry, restrained sharpness.
 *
 * v3 (current): v2 still read as too "professional portrait" — flattering
 * light, shallow depth of field/bokeh, an overly clean face, an overly
 * aesthetic composition. v3 pushes further toward a genuinely utilitarian
 * ID/administrative snapshot: flat fluorescent ceiling light, a sharp
 * (non-bokeh) in-focus background, normal small-camera depth of field,
 * imperfect white balance, subtle digital noise, an unstyled/un-posed
 * look, and an explicit negative-prompt block ruling out every
 * studio/beauty/fashion/corporate-headshot cue. Also starts using
 * `skinTone` for physical diversity (see `SKIN_TONE_WORD` below) — still
 * derived purely from the person's own seed, never from role/guilt. */
export const CHARACTER_PROMPT_VERSION = 3;

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

/** Derived only from guilt-safe public traits (age bracket, a profession
 * category matched from job title text — see `clothingCategoryForProfession`
 * in `visual-manifest.ts`) — never from role/guilt. Deliberately avoids
 * defaulting "formal" to a business suit: most real administrative photos
 * of someone in a formal-leaning profession still show them in ordinary
 * clothes, not a tailored suit. */
const CLOTHING_PHRASE: Record<CharacterVisualDescriptor["clothingCategory"], string> = {
  casual: "ordinary, slightly worn everyday clothing",
  formal: "modest, practical smart-casual attire such as a plain shirt or blouse — not a tailored business suit",
  workwear: "practical workwear appropriate to manual or technical work",
  uniform: "a plain, non-branded uniform, worn only because the person's own occupation calls for one",
  sport: "simple, ordinary athletic wear",
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
  slight_turn: "head turned very slightly to one side, otherwise facing the camera",
};

/** The fixed skin-tone palette in `visual-manifest.ts` mapped to plain,
 * neutral descriptive words — same rationale as `HAIR_COLOR_WORD`. Was
 * defined on the descriptor since the guilt-safety milestone but never
 * actually read by a prompt builder until v3; wiring it in adds physical
 * diversity to generated portraits, still derived purely from the
 * person's own seed (`pick(\`${seed}:skin\`, SKIN_TONES)` in
 * `visual-manifest.ts`) — never from role, guilt, or any hidden field. */
const SKIN_TONE_WORD: Record<string, string> = {
  "#e8c9a8": "light",
  "#d4a878": "light-medium",
  "#b98858": "medium",
  "#8f6239": "medium-dark",
  "#5c4028": "dark",
  "#f0d5b8": "fair",
};

/**
 * Deterministic, server-only prompt builder. Takes *only*
 * `CharacterVisualDescriptor` — the same guilt-safety guarantee that type
 * already carries (built from `Person` fields alone, never `CaseTruth`)
 * means this function has no way to leak culprit/accomplice/motive status
 * into a prompt, structurally, not by convention. Never interpolates the
 * descriptor's own `personId` or any name/profession text — only the
 * abstracted visual traits. A suspect, a victim, a witness, and the actual
 * culprit all go through this exact same function with no branch on role
 * anywhere in it — the word "role" does not even appear in this file.
 *
 * Target style (v3): a genuinely utilitarian European administrative
 * identification photograph, taken quickly in an institutional setting —
 * not a professional portrait in any sense (no studio, no beauty
 * retouching, no shallow depth of field). The goal is banal and
 * credible, never sinister: a suspect, a witness, the victim, and the
 * actual culprit must all read as equally ordinary, unremarkable people.
 */
export function buildCharacterPortraitPrompt(descriptor: CharacterVisualDescriptor): string {
  const subject = `${AGE_PHRASE[descriptor.approxAge]} ${PRESENTATION_PHRASE[descriptor.presentation]}`;
  const skin = SKIN_TONE_WORD[descriptor.skinTone] ?? "medium";
  const hairColor = HAIR_COLOR_WORD[descriptor.hairColor] ?? "neutral-toned";
  const hair = `${hairColor} ${HAIRSTYLE_PHRASE[descriptor.hairstyle]}`;
  const face = FACE_SHAPE_PHRASE[descriptor.faceShape];
  const clothing = CLOTHING_PHRASE[descriptor.clothingCategory];
  const framing = FRAMING_PHRASE[descriptor.framing];

  return (
    `Ordinary administrative identification photograph of a ${subject}, ${skin} skin, ${face}, ${hair}, ${framing}. ` +
    `Wearing ${clothing}. A utilitarian documentation photo taken quickly in a European institutional setting, ` +
    `not a professional portrait session. ` +
    `Genuinely neutral expression, mouth relaxed and closed, no subtle smile. Natural, slightly imperfect posture, ` +
    `subject not necessarily perfectly centered. Ordinary, unstyled hair, not specially prepared for a photo. ` +
    `Banal administrative framing: head, shoulders, and upper torso, camera roughly at eye level. ` +
    `Diffuse, ordinary fluorescent ceiling light, relatively flat frontal lighting, no cinematic or studio lighting. ` +
    `Institutional background sharp and clearly visible, normal depth of field for a small administrative camera — ` +
    `face, clothing, and background all in focus together. ` +
    `Moderate contrast, sober realistic colors, slightly imperfect white balance, subtle digital noise/grain. ` +
    `Natural skin texture with visible pores and fine wrinkles, normal ordinary asymmetries, no beauty retouching. ` +
    `ordinary administrative identification photograph, utilitarian documentation photo, flat practical lighting, ` +
    `normal depth of field, background remains visible and in focus, no bokeh, no shallow depth of field, ` +
    `no portrait lens look, no studio photography, no cinematic lighting, no beauty photography, ` +
    `no fashion photography, no corporate headshot, no LinkedIn portrait, no glamour, no dramatic lighting, ` +
    `no color grading, no professional portrait composition, no heroic or villainous visual cues. ` +
    `Grounded fictional European person, clearly fictional, no real likeness. ` +
    `No text, no badge, no logo, no watermark, no mugshot board.`
  );
}

export function characterPromptHash(descriptor: CharacterVisualDescriptor): number {
  return hashSeed(`${CHARACTER_PROMPT_VERSION}:${buildCharacterPortraitPrompt(descriptor)}`);
}
