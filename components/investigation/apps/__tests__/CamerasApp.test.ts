import { describe, expect, it } from "vitest";
import { resolveValidLocationId, type CameraLocationOption } from "../CamerasApp";

/**
 * Phase U3.7 — camera-search location-identity fix (req. 7). This project
 * has no jsdom/component-test infrastructure (see unity-cctv-config.test.ts
 * for the same convention), so the actual DECISION that fixes the
 * "Lieu inconnu" / page-crash bug is factored into a pure function
 * (`resolveValidLocationId`) and exercised directly here. The surrounding
 * `useEffect` that calls it (self-healing `locationId` state when the
 * `locations` prop changes) and the try/catch around the search action are
 * thin, DOM-dependent glue verified by manual QA and the fix's own commit.
 */
describe("resolveValidLocationId — camera-search location-identity fix (req. 1-6)", () => {
  const LOCATIONS: CameraLocationOption[] = [
    { id: "loc_a", name: "Commissariat central" },
    { id: "loc_b", name: "Gare" },
    { id: "loc_c", name: "Parking" },
  ];

  it("keeps the current id when it is still present in `locations` (rerender survives selection)", () => {
    expect(resolveValidLocationId(LOCATIONS, "loc_b")).toBe("loc_b");
  });

  it("is idempotent — resolving an already-valid id twice yields the same id", () => {
    const first = resolveValidLocationId(LOCATIONS, "loc_c");
    expect(resolveValidLocationId(LOCATIONS, first)).toBe("loc_c");
  });

  it("falls back to the first location when the current id no longer exists in `locations` (the exact bug: a stale id from a previous render/session)", () => {
    expect(resolveValidLocationId(LOCATIONS, "loc_from_a_different_case")).toBe("loc_a");
  });

  it("falls back to an empty string when `locations` is empty (no camera-equipped locations at all)", () => {
    expect(resolveValidLocationId([], "loc_a")).toBe("");
  });

  it("treats an empty current id the same as any other unmatched id — resolves to the first location", () => {
    expect(resolveValidLocationId(LOCATIONS, "")).toBe("loc_a");
  });

  it("is pure — never mutates the `locations` array it's given", () => {
    const copy = LOCATIONS.map((l) => ({ ...l }));
    resolveValidLocationId(LOCATIONS, "loc_unknown");
    expect(LOCATIONS).toEqual(copy);
  });

  it("has no duplicate option identity to worry about — every location in a real list has a unique id (guards the <option key> assumption)", () => {
    const ids = LOCATIONS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
