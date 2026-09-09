import { describe, expect, it } from "vitest";
import { buildReusablePortraitDescriptor, buildReusableSceneDescriptor, reusePortraitKey, reuseSceneKey } from "../reusable-descriptor";
import { buildCharacterVisualDescriptor, buildCrimeSceneVisualDescriptor } from "../../visual-manifest";
import { hashDescriptor } from "../../asset-cache";

describe("buildReusablePortraitDescriptor", () => {
  it("keeps only the 4 coarse fields — no personId, no seed, no hidden data", () => {
    const descriptor = buildCharacterVisualDescriptor({ id: "p1", age: 40, sex: "female", profession: "comptable", avatarSeed: "seed-1" });
    const reusable = buildReusablePortraitDescriptor(descriptor);
    expect(Object.keys(reusable).sort()).toEqual(["approxAge", "clothingCategory", "hairstyle", "presentation"]);
  });

  it("two DIFFERENT people who happen to share the same 4 coarse fields produce the SAME reuse key", () => {
    // Bypasses person generation entirely — the point of this test is the
    // key computation (hashDescriptor over the coarse projection), not
    // whether two real people naturally collide.
    const reusableA = { approxAge: "middle" as const, presentation: "masculine" as const, hairstyle: "short" as const, clothingCategory: "uniform" as const };
    const reusableB = { ...reusableA };
    expect(hashDescriptor(reusableA)).toBe(hashDescriptor(reusableB));
  });

  it("two people with DIFFERENT personId but identical coarse traits produce the same key via the real builder", () => {
    const a = buildCharacterVisualDescriptor({ id: "p1", age: 40, sex: "male", profession: "agent", avatarSeed: "seed-alpha" });
    const b = buildCharacterVisualDescriptor({ id: "p2", age: 41, sex: "male", profession: "agent", avatarSeed: "seed-alpha" }); // same seed -> same hairstyle pick
    // personId/age differ slightly (41 vs 40, still same "middle" band) —
    // proves the key is computed from the coarse fields only, not from
    // personId.
    expect(reusePortraitKey(a)).toBe(reusePortraitKey(b));
  });

  it("is a pure function of its input: same descriptor -> same key, always", () => {
    const descriptor = buildCharacterVisualDescriptor({ id: "p1", age: 25, sex: "female", profession: "avocate", avatarSeed: "seed-x" });
    expect(reusePortraitKey(descriptor)).toBe(reusePortraitKey(descriptor));
  });

  it("a different profession bucket (-> different clothingCategory) changes the key even with identical age/sex/seed", () => {
    const base = { id: "p1", age: 40, sex: "male" as const, avatarSeed: "seed-y" };
    const uniform = buildCharacterVisualDescriptor({ ...base, profession: "agent" });
    const casual = buildCharacterVisualDescriptor({ ...base, profession: "serveur" });
    expect(reusePortraitKey(uniform)).not.toBe(reusePortraitKey(casual));
  });
});

describe("buildReusableSceneDescriptor", () => {
  it("keeps only the 3 coarse fields — no locationId, no seed, no weather", () => {
    const descriptor = buildCrimeSceneVisualDescriptor({ id: "loc1", type: "office" }, 700);
    const reusable = buildReusableSceneDescriptor(descriptor);
    expect(Object.keys(reusable).sort()).toEqual(["architectureStyle", "layoutTemplate", "timeOfDay"]);
  });

  it("two DIFFERENT locations of a single-candidate type (e.g. office) always produce the SAME reuse key, regardless of id", () => {
    const a = buildCrimeSceneVisualDescriptor({ id: "loc-a", type: "office" }, 700);
    const b = buildCrimeSceneVisualDescriptor({ id: "loc-b", type: "office" }, 700);
    expect(reuseSceneKey(a)).toBe(reuseSceneKey(b));
  });

  it("a different time-of-day (from a different crimeTimestamp) changes the key", () => {
    const day = buildCrimeSceneVisualDescriptor({ id: "loc-a", type: "office" }, 12 * 60); // noon
    const night = buildCrimeSceneVisualDescriptor({ id: "loc-a", type: "office" }, 2 * 60); // 2am
    expect(reuseSceneKey(day)).not.toBe(reuseSceneKey(night));
  });

  it("is a pure function of its input: same descriptor -> same key, always", () => {
    const descriptor = buildCrimeSceneVisualDescriptor({ id: "loc1", type: "warehouse" }, 700);
    expect(reuseSceneKey(descriptor)).toBe(reuseSceneKey(descriptor));
  });
});
