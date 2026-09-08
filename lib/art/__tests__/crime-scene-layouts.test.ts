import { describe, expect, it } from "vitest";
import { ALL_LAYOUT_IDS, chooseLayoutTemplate, getLayout, getZonesForLocation } from "../crime-scene-layouts";
import type { LocationType } from "@/lib/game-engine/types/location";

const ALL_LOCATION_TYPES: LocationType[] = [
  "police_station",
  "apartment",
  "house",
  "restaurant",
  "bar",
  "office",
  "parking",
  "bank",
  "pharmacy",
  "hospital",
  "train_station",
  "gas_station",
  "shop",
  "hotel",
  "park",
  "warehouse",
];

describe("crime-scene-layouts", () => {
  it("resolves every location type to a valid, known layout template", () => {
    for (const type of ALL_LOCATION_TYPES) {
      const layoutId = chooseLayoutTemplate(type, `loc-${type}`);
      expect(ALL_LAYOUT_IDS).toContain(layoutId);
    }
  });

  it("every layout provides exactly 7 zone slots (matches the fixed hotspot-count contract)", () => {
    for (const id of ALL_LAYOUT_IDS) {
      expect(getLayout(id).zones).toHaveLength(7);
    }
  });

  it("is deterministic for the same location type + seed", () => {
    const a = chooseLayoutTemplate("apartment", "loc-1:apartment");
    const b = chooseLayoutTemplate("apartment", "loc-1:apartment");
    expect(a).toBe(b);
  });

  it("getZonesForLocation returns the zones of the chosen layout", () => {
    const zones = getZonesForLocation("warehouse", "loc-2:warehouse");
    expect(zones).toHaveLength(7);
    expect(zones.every((z) => typeof z.x === "number" && typeof z.y === "number")).toBe(true);
  });
});
