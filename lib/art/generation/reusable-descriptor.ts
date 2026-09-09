import type { CharacterVisualDescriptor, CrimeSceneVisualDescriptor, Hairstyle, ClothingCategory, Presentation } from "../visual-manifest";
import type { LayoutTemplateId } from "../crime-scene-layouts";
import type { ArchitectureStyle } from "../visual-manifest";
import type { TimeOfDay } from "../lighting";
import { hashDescriptor } from "../asset-cache";

/**
 * Living Investigation System — Generated Art V2B.
 *
 * A "reusable descriptor" is a deliberately coarser projection of the
 * existing exact visual descriptors (`CharacterVisualDescriptor` /
 * `CrimeSceneVisualDescriptor`), stripped of every entity-specific field
 * (`personId`, `seed`/`locationId`) so that two DIFFERENT people or
 * locations — in two different cases, always the same user — can share
 * one already-generated image when their coarse visual traits match.
 *
 * This is strictly additive to the existing exact cache (`descriptor_hash`
 * in `asset-store.ts`), never a replacement: `reuseKey` is a SEPARATE hash,
 * computed and stored in a SEPARATE column (`generated_assets.reuse_key`),
 * with its own, deliberately coarser, matching semantics. Nothing about
 * how the exact cache computes or compares `descriptor_hash` changes.
 *
 * Guilt-safety: every field below is copied from a field that already
 * exists on `CharacterVisualDescriptor`/`CrimeSceneVisualDescriptor` —
 * both of which are already guilt-safe by construction (built only from
 * `GuiltSafePersonFields`/`GuiltSafeLocationFields`, see
 * `visual-manifest.ts`). This module reads no `CaseTruth` field, no
 * `Person.roles`, no motive, no evidence, no discovery state, and no
 * `personId`/`locationId` (the one thing that WOULD make two different
 * people/locations distinguishable) — see the field-by-field notes below.
 */

/**
 * Portrait reuse key. Deliberately narrower than the full
 * `CharacterVisualDescriptor` — `hairColor`, `faceShape`, `skinTone`, and
 * `framing` are each individually guilt-safe (same derivation, same
 * source fields) but are intentionally NOT included here: keeping all 8
 * fields would make this bucket almost as narrow as the exact hash itself
 * (near-zero real reuse), since a person's own seed already varies most
 * of those secondary traits. The 4 fields kept are the ones that read as
 * "a visually different kind of person" in a small avatar — coarse enough
 * that the bucket space (~240 combinations: 3 age bands × 2 presentations
 * × 8 hairstyles × 5 clothing categories) fills up after a realistic
 * handful of played cases, which is the entire point of this feature.
 */
export interface ReusablePortraitDescriptor {
  /** From `person.age`, bucketed into 3 bands — a demographic fact, not a
   * role or guilt signal. */
  approxAge: CharacterVisualDescriptor["approxAge"];
  /** From `person.sex` — a physical presentation fact, not guilt. */
  presentation: Presentation;
  /** A cosmetic style choice, itself derived only from the person's own
   * `avatarSeed` (never from role/guilt) in `buildCharacterVisualDescriptor`. */
  hairstyle: Hairstyle;
  /** Derived from `person.profession` via a fixed regex mapping (see
   * `clothingCategoryForProfession`) — profession is already player-visible
   * on the case dossier/briefing before any investigation happens; it is
   * not a hidden fact and carries no guilt information on its own (both
   * the victim, every suspect, and every witness have an ordinary
   * profession). */
  clothingCategory: ClothingCategory;
}

/** Strips a full exact descriptor down to the reuse-key fields. Takes the
 * already-guilt-safe `CharacterVisualDescriptor` (never `Person`/`CaseTruth`
 * directly) so this function inherits that guarantee rather than needing
 * to re-derive it. */
export function buildReusablePortraitDescriptor(descriptor: CharacterVisualDescriptor): ReusablePortraitDescriptor {
  return {
    approxAge: descriptor.approxAge,
    presentation: descriptor.presentation,
    hairstyle: descriptor.hairstyle,
    clothingCategory: descriptor.clothingCategory,
  };
}

export function reusePortraitKey(descriptor: CharacterVisualDescriptor): string {
  return hashDescriptor(buildReusablePortraitDescriptor(descriptor));
}

/**
 * Crime-scene reuse key. Drops `locationId`/`seed` (entity-specific) and
 * `weather` — `weather` only ever affects the actual rendered prompt for
 * the one open-air layout ("alley"; see `crime-scene-prompt.ts`'s own
 * comment), so excluding it from the reuse key means an indoor scene's
 * reuse bucket is always exact-prompt-equivalent, and only the rare alley
 * case accepts a cosmetic weather mismatch on a reused background — a
 * deliberate, documented trade-off, not an oversight.
 */
export interface ReusableSceneDescriptor {
  /** A fixed room-template id (see `crime-scene-layouts.ts`) — a purely
   * structural/cosmetic choice, never a function of case content. */
  layoutTemplate: LayoutTemplateId;
  /** Derived from `crimeTimestamp` bucketed into day/evening/night — the
   * crime's timing is already player-visible (autopsy report) before the
   * scene is ever explored; this is a lighting fact, not a clue. */
  timeOfDay: TimeOfDay;
  /** Derived only from `location.type` (see `ARCHITECTURE_BY_TYPE`) — a
   * structural property of the building itself, never of the case. */
  architectureStyle: ArchitectureStyle;
}

export function buildReusableSceneDescriptor(descriptor: CrimeSceneVisualDescriptor): ReusableSceneDescriptor {
  return {
    layoutTemplate: descriptor.layoutTemplate,
    timeOfDay: descriptor.timeOfDay,
    architectureStyle: descriptor.architectureStyle,
  };
}

export function reuseSceneKey(descriptor: CrimeSceneVisualDescriptor): string {
  return hashDescriptor(buildReusableSceneDescriptor(descriptor));
}
