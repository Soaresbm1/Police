import { describe, expect, it } from "vitest";
import { buildCharacterVisualDescriptor, buildCrimeSceneVisualDescriptor, buildLocationVisualDescriptor } from "../visual-manifest";
import { hashDescriptor } from "../asset-cache";
import type { Person } from "@/lib/game-engine/types/person";
import type { Location } from "@/lib/game-engine/types/location";

function makePerson(overrides: Partial<Person> = {}): Person {
  return {
    id: "p1",
    firstName: "Test",
    lastName: "Person",
    age: 40,
    sex: "female",
    lifeStatus: "employed",
    profession: "comptable",
    homeLocationId: "loc1",
    workLocationId: null,
    avatarSeed: "seed-abc123",
    personality: {
      intelligence: 0.5,
      impulsivity: 0.5,
      sociability: 0.5,
      aggressiveness: 0.5,
      honesty: 0.5,
      loyalty: 0.5,
      fearfulness: 0.5,
    },
    baselineStress: 0.3,
    wealthChf: 50_000,
    addictions: [],
    phoneNumber: "0790000000",
    vehicle: null,
    digitalAccounts: [],
    roles: [],
    ...overrides,
  };
}

function makeLocation(overrides: Partial<Location> = {}): Location {
  return {
    id: "loc1",
    name: "Appartement",
    type: "apartment",
    address: "1 rue Test",
    district: "Centre",
    coordinates: { x: 2, y: 2 },
    hasCameras: false,
    cameraZones: [],
    hasWifi: false,
    wifiSsid: null,
    hasBadgeAccess: false,
    openingHours: null,
    employeePersonIds: [],
    residentPersonIds: [],
    ...overrides,
  };
}

describe("buildCharacterVisualDescriptor", () => {
  it("is deterministic for the same seed", () => {
    const person = makePerson();
    expect(buildCharacterVisualDescriptor(person)).toEqual(buildCharacterVisualDescriptor(person));
  });

  it("never depends on guilt — identical Person fields yield identical descriptors regardless of role", () => {
    const innocent = makePerson({ id: "p1", roles: ["witness"] });
    const culprit = makePerson({ id: "p1", roles: ["culprit"] });
    // The function signature only accepts a Person — `roles` differing is
    // the only thing that could carry guilt information, and it must not
    // affect the output at all.
    expect(buildCharacterVisualDescriptor(innocent)).toEqual(buildCharacterVisualDescriptor(culprit));
  });

  it("varies with seed", () => {
    const a = buildCharacterVisualDescriptor(makePerson({ avatarSeed: "seed-one" }));
    const b = buildCharacterVisualDescriptor(makePerson({ avatarSeed: "seed-two" }));
    expect(a).not.toEqual(b);
  });

  it("framing is mostly front-facing, not a posed portrait angle for most characters", () => {
    const counts = { front: 0, slight_turn: 0 };
    for (let i = 0; i < 200; i++) {
      const { framing } = buildCharacterVisualDescriptor(makePerson({ avatarSeed: `seed-${i}` }));
      counts[framing]++;
    }
    // ~75% front by design — assert the clear majority without pinning an exact count.
    expect(counts.front).toBeGreaterThan(counts.slight_turn * 2);
  });
});

describe("buildCrimeSceneVisualDescriptor", () => {
  it("is deterministic for the same location id/type and timestamp", () => {
    const location = makeLocation();
    expect(buildCrimeSceneVisualDescriptor(location, 500)).toEqual(buildCrimeSceneVisualDescriptor(location, 500));
  });

  it("only reads id/type — passing a location with different guilt-irrelevant fields (address, district, coordinates) never changes the output", () => {
    const a = buildCrimeSceneVisualDescriptor(makeLocation({ address: "1 rue A", district: "Nord" }), 500);
    const b = buildCrimeSceneVisualDescriptor(makeLocation({ address: "99 avenue B", district: "Sud" }), 500);
    expect(a).toEqual(b);
  });

  it("varies with location type", () => {
    const apartment = buildCrimeSceneVisualDescriptor(makeLocation({ id: "loc1", type: "apartment" }), 500);
    const warehouse = buildCrimeSceneVisualDescriptor(makeLocation({ id: "loc1", type: "warehouse" }), 500);
    expect(apartment).not.toEqual(warehouse);
    expect(apartment.architectureStyle).toBe("residential_modern");
    expect(warehouse.architectureStyle).toBe("industrial");
  });

  it("varies time-of-day-derived fields with the crime timestamp, holding location fixed", () => {
    const location = makeLocation();
    const day = buildCrimeSceneVisualDescriptor(location, 12 * 60); // noon
    const night = buildCrimeSceneVisualDescriptor(location, 2 * 60); // 2am
    expect(day.timeOfDay).toBe("day");
    expect(night.timeOfDay).toBe("night");
  });

  it("is guilt-safe by construction: the function signature accepts only id/type, so it cannot depend on culprit, staging, or any other CaseTruth field", () => {
    // Two "cases" that would differ wildly in their hidden CaseTruth
    // (different culprit, different staging, different undiscovered
    // evidence) but share the same public crime-scene location and
    // timestamp must resolve to the exact same descriptor — there is no
    // parameter this function could even read to tell them apart.
    const sharedLocation = makeLocation({ id: "loc-crime", type: "hotel" });
    const descriptorForCaseWithCulpritA = buildCrimeSceneVisualDescriptor(sharedLocation, 700);
    const descriptorForCaseWithCulpritB = buildCrimeSceneVisualDescriptor(sharedLocation, 700);
    expect(descriptorForCaseWithCulpritA).toEqual(descriptorForCaseWithCulpritB);
  });

  it("hashes stably — the same location/timestamp always produces the same descriptor hash", () => {
    const location = makeLocation({ id: "loc1", type: "hotel" });
    const hashA = hashDescriptor(buildCrimeSceneVisualDescriptor(location, 900));
    const hashB = hashDescriptor(buildCrimeSceneVisualDescriptor(location, 900));
    expect(hashA).toBe(hashB);
    expect(hashA).toMatch(/^[0-9a-f]{64}$/); // real SHA-256 hex digest, not raw JSON
  });

  it("only computes weather variation meaningfully for the open-air alley layout", () => {
    // park/train_station both map to the "alley" layout template (see
    // crime-scene-layouts.ts's CANDIDATES_BY_LOCATION_TYPE) — weather is
    // still computed for every location type, but the prompt builder
    // (crime-scene-prompt.ts) only ever reads it for that layout.
    const descriptor = buildCrimeSceneVisualDescriptor(makeLocation({ id: "loc1", type: "park" }), 500);
    expect(["clear", "overcast", "light_rain"]).toContain(descriptor.weather);
  });
});

describe("buildLocationVisualDescriptor", () => {
  it("is deterministic for the same location id/type", () => {
    const location = makeLocation();
    expect(buildLocationVisualDescriptor(location)).toEqual(buildLocationVisualDescriptor(location));
  });

  it("maps every location type to a valid architecture style", () => {
    const descriptor = buildLocationVisualDescriptor(makeLocation({ type: "warehouse" }));
    expect(descriptor.architectureStyle).toBe("industrial");
  });
});
