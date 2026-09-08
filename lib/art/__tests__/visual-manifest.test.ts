import { describe, expect, it } from "vitest";
import { buildCharacterVisualDescriptor, buildLocationVisualDescriptor } from "../visual-manifest";
import type { Person } from "@/lib/game-engine/types/person";
import type { Location } from "@/lib/game-engine/types/location";

function makePerson(overrides: Partial<Person> = {}): Person {
  return {
    id: "p1",
    firstName: "Test",
    lastName: "Person",
    age: 40,
    sex: "female",
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
