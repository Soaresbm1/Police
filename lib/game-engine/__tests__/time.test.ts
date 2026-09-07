import { describe, expect, it } from "vitest";
import { formatDuration, formatGameTime, hm } from "../types/time";

describe("time formatting", () => {
  it("formatGameTime renders day and time of day", () => {
    expect(formatGameTime(hm(17, 6))).toBe("Jour 1, 17:06");
    expect(formatGameTime(hm(24 + 1, 30))).toBe("Jour 2, 01:30");
  });

  it("formatDuration renders elapsed minutes, not a point in time", () => {
    expect(formatDuration(0)).toBe("0min");
    expect(formatDuration(45)).toBe("45min");
    expect(formatDuration(65)).toBe("1h 05min");
    expect(formatDuration(24 * 60 + 5)).toBe("24h 05min");
  });
});
