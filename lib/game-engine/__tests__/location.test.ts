import { describe, expect, it } from "vitest";
import { distanceKm, isOpenAt, travelMinutes } from "../types/location";

describe("location/travel math", () => {
  it("distanceKm computes Euclidean distance", () => {
    expect(distanceKm({ x: 0, y: 0 }, { x: 3, y: 4 })).toBeCloseTo(5);
  });

  it("travelMinutes is always at least 1 minute", () => {
    expect(travelMinutes({ x: 0, y: 0 }, { x: 0, y: 0 }, "car")).toBeGreaterThanOrEqual(1);
  });

  it("car is always at least as fast as walking for the same distance", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 5, y: 5 };
    const carTime = travelMinutes(a, b, "car");
    const footTime = travelMinutes(a, b, "foot");
    expect(carTime).toBeLessThanOrEqual(footTime);
  });

  it("isOpenAt handles ordinary and midnight-spanning hours", () => {
    expect(isOpenAt({ open: 8 * 60, close: 17 * 60 }, 12 * 60)).toBe(true);
    expect(isOpenAt({ open: 8 * 60, close: 17 * 60 }, 20 * 60)).toBe(false);
    expect(isOpenAt({ open: 22 * 60, close: 2 * 60 }, 23 * 60)).toBe(true);
    expect(isOpenAt({ open: 22 * 60, close: 2 * 60 }, 1 * 60)).toBe(true);
    expect(isOpenAt({ open: 22 * 60, close: 2 * 60 }, 12 * 60)).toBe(false);
    expect(isOpenAt(null, 3 * 60)).toBe(true);
  });
});
