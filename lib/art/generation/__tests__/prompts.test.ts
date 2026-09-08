import { describe, expect, it } from "vitest";
import { buildCharacterPortraitPrompt } from "../character-prompt";
import { buildCrimeSceneEnvironmentPrompt } from "../crime-scene-prompt";
import type { CharacterVisualDescriptor, CrimeSceneVisualDescriptor } from "../../visual-manifest";

function makeCharacterDescriptor(overrides: Partial<CharacterVisualDescriptor> = {}): CharacterVisualDescriptor {
  return {
    personId: "person_super_secret_id_42",
    seed: "seed-abc",
    approxAge: "middle",
    presentation: "feminine",
    hairstyle: "bun",
    hairColor: "#4a3728",
    faceShape: "oval",
    clothingCategory: "formal",
    skinTone: "#d4a878",
    framing: "slight_turn",
    ...overrides,
  };
}

function makeSceneDescriptor(overrides: Partial<CrimeSceneVisualDescriptor> = {}): CrimeSceneVisualDescriptor {
  return {
    locationId: "location_super_secret_id_99",
    seed: "loc-seed:apartment",
    layoutTemplate: "apartment_living_room",
    timeOfDay: "night",
    ...overrides,
  };
}

describe("buildCharacterPortraitPrompt", () => {
  it("is deterministic for the same descriptor", () => {
    const d = makeCharacterDescriptor();
    expect(buildCharacterPortraitPrompt(d)).toBe(buildCharacterPortraitPrompt(d));
  });

  it("never leaks the descriptor's own personId or seed into the prompt text", () => {
    const d = makeCharacterDescriptor();
    const prompt = buildCharacterPortraitPrompt(d);
    expect(prompt).not.toContain(d.personId);
    expect(prompt).not.toContain(d.seed);
  });

  it("never mentions guilt/culprit/accomplice vocabulary (the type itself has no such field)", () => {
    const prompt = buildCharacterPortraitPrompt(makeCharacterDescriptor());
    for (const forbidden of ["culprit", "guilty", "accomplice", "suspect", "victim", "lying", "motive"]) {
      expect(prompt.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("varies with visual traits", () => {
    const a = buildCharacterPortraitPrompt(makeCharacterDescriptor({ hairstyle: "bald" }));
    const b = buildCharacterPortraitPrompt(makeCharacterDescriptor({ hairstyle: "long" }));
    expect(a).not.toBe(b);
  });

  it("includes the required anti-professional-portrait negative-prompt block verbatim (v3)", () => {
    const prompt = buildCharacterPortraitPrompt(makeCharacterDescriptor());
    expect(prompt).toContain(
      "ordinary administrative identification photograph, utilitarian documentation photo, flat practical lighting, " +
        "normal depth of field, background remains visible and in focus, no bokeh, no shallow depth of field, " +
        "no portrait lens look, no studio photography, no cinematic lighting, no beauty photography, " +
        "no fashion photography, no corporate headshot, no LinkedIn portrait, no glamour, no dramatic lighting, " +
        "no color grading, no professional portrait composition",
    );
  });

  it("uses skinTone for physical diversity, and it varies the prompt", () => {
    const light = buildCharacterPortraitPrompt(makeCharacterDescriptor({ skinTone: "#e8c9a8" }));
    const dark = buildCharacterPortraitPrompt(makeCharacterDescriptor({ skinTone: "#5c4028" }));
    expect(light).toContain("light skin");
    expect(dark).toContain("dark skin");
    expect(light).not.toBe(dark);
  });

  it("never implies the subject looks sinister, criminal, or unsettling", () => {
    const prompt = buildCharacterPortraitPrompt(makeCharacterDescriptor()).toLowerCase();
    for (const forbidden of ["sinister", "criminal", "menacing", "creepy", "evil"]) {
      expect(prompt).not.toContain(forbidden);
    }
    // The one deliberate exception: a negative instruction ruling out
    // villain/hero framing, phrased as "no ... visual cues" — never as a
    // positive description of the subject.
    expect(prompt).toContain("no heroic or villainous visual cues");
  });
});

describe("buildCrimeSceneEnvironmentPrompt", () => {
  it("is deterministic for the same descriptor", () => {
    const d = makeSceneDescriptor();
    expect(buildCrimeSceneEnvironmentPrompt(d)).toBe(buildCrimeSceneEnvironmentPrompt(d));
  });

  it("never leaks the descriptor's own locationId or seed into the prompt text", () => {
    const d = makeSceneDescriptor();
    const prompt = buildCrimeSceneEnvironmentPrompt(d);
    expect(prompt).not.toContain(d.locationId);
    expect(prompt).not.toContain(d.seed);
  });

  it("never describes evidence, staging, or the victim's body as present — environment only", () => {
    const prompt = buildCrimeSceneEnvironmentPrompt(makeSceneDescriptor()).toLowerCase();
    // "no evidence markers" etc. are deliberate negative instructions to
    // the image model — what must never appear is any of these described
    // as *present* in the scene.
    for (const forbidden of ["weapon", "fingerprint", "staged", "culprit", "corpse", "victim"]) {
      expect(prompt).not.toContain(forbidden);
    }
    expect(prompt).toContain("no people, no bodies");
    expect(prompt).toContain("no evidence markers");
  });
});
