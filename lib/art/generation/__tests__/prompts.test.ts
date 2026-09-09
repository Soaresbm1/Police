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
    architectureStyle: "residential_modern",
    weather: "clear",
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
    // "weapon"/"fingerprint"/etc. legitimately appear inside the negative
    // safety clause ("do not depict weapons... fingerprints...") — that's
    // required, not a leak. What must never appear at all is any
    // guilt/identity vocabulary, since nothing in the prompt builder has
    // access to it in the first place.
    for (const forbidden of ["staged", "culprit", "accomplice", "corpse", "victim", "motive"]) {
      expect(prompt).not.toContain(forbidden);
    }
    expect(prompt).toContain("no people visible anywhere");
  });

  it("includes the exact no-decisive-evidence safety clause verbatim", () => {
    const prompt = buildCrimeSceneEnvironmentPrompt(makeSceneDescriptor());
    expect(prompt).toContain(
      "The room must contain only ordinary environmental details and generic clutter. Do not depict weapons, blood, " +
        "bodies, police evidence markers, readable documents, fingerprints, footprints, broken objects, suspicious " +
        "objects, or any visually decisive clue. Investigative evidence is rendered separately by the game engine.",
    );
  });

  it("never invents a stylized/cinematic/AI-surreal look", () => {
    const prompt = buildCrimeSceneEnvironmentPrompt(makeSceneDescriptor()).toLowerCase();
    expect(prompt).toContain("no stylized concept-art look");
    expect(prompt).toContain("no extreme noir");
    expect(prompt).toContain("no dramatic horror aesthetic");
    expect(prompt).toContain("no obvious ai surrealism");
  });

  it("varies with architecture style and layout, never with locationId/seed", () => {
    const a = buildCrimeSceneEnvironmentPrompt(makeSceneDescriptor({ architectureStyle: "residential_modern" }));
    const b = buildCrimeSceneEnvironmentPrompt(makeSceneDescriptor({ architectureStyle: "industrial" }));
    expect(a).not.toBe(b);
  });

  it("only mentions weather for the open-air alley layout, never for an interior layout", () => {
    const interior = buildCrimeSceneEnvironmentPrompt(makeSceneDescriptor({ layoutTemplate: "apartment_living_room", weather: "light_rain" }));
    expect(interior.toLowerCase()).not.toContain("wet pavement");
    expect(interior.toLowerCase()).not.toContain("overcast");

    const dryAlley = buildCrimeSceneEnvironmentPrompt(makeSceneDescriptor({ layoutTemplate: "alley", weather: "clear" }));
    const rainyAlley = buildCrimeSceneEnvironmentPrompt(makeSceneDescriptor({ layoutTemplate: "alley", weather: "light_rain" }));
    expect(dryAlley).not.toBe(rainyAlley);
    expect(rainyAlley.toLowerCase()).toContain("wet pavement");
  });

  it("is unaffected by anything CaseTruth-shaped — the descriptor type structurally cannot carry it", () => {
    // buildCrimeSceneEnvironmentPrompt only ever accepts a
    // CrimeSceneVisualDescriptor (locationId/seed/layoutTemplate/timeOfDay/
    // architectureStyle/weather) — there is no culpritId, accompliceIds,
    // staging, tamperingEvents, or evidence field anywhere on that type for
    // this test to even attempt to vary. Two descriptors built from the
    // exact same public-safe location/time, standing in for two cases that
    // differ only in their hidden CaseTruth, must produce an identical
    // prompt.
    const fromCaseA = makeSceneDescriptor();
    const fromCaseB = makeSceneDescriptor(); // simulates a different CaseTruth, same public location/time
    expect(buildCrimeSceneEnvironmentPrompt(fromCaseA)).toBe(buildCrimeSceneEnvironmentPrompt(fromCaseB));
  });
});
