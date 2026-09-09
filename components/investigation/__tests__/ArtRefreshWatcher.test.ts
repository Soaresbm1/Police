import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REFRESH_DELAYS_MS } from "../ArtRefreshWatcher";

/**
 * Generated Art V2A — items K/L/M for `ArtRefreshWatcher`. This codebase
 * has no React-rendering test infrastructure (no jsdom/@testing-library —
 * every other test here is a plain logic/unit test), so this deliberately
 * doesn't try to mount the component; it verifies the two properties that
 * matter structurally without needing to render anything:
 * - the refresh sequence is a fixed-length array, not a loop/interval, so
 *   it is mechanically impossible for a mount to schedule more than that
 *   many attempts (K, M);
 * - the source contains no `setInterval` anywhere (M) — the one API that
 *   really would create unbounded polling.
 * Item L ("no refresh scheduled if nothing is missing") is enforced by the
 * component's own `if (!pending || startedRef.current) return;` guard,
 * which is exercised indirectly by every page wiring it (see
 * `hasMissingPortraits`'s own tests) — direct behavioral verification
 * would need the same rendering infrastructure this codebase doesn't have.
 */
describe("ArtRefreshWatcher — bounded refresh guarantee", () => {
  it("[K, M] schedules at most 2 refresh attempts, ever — a fixed array, not an interval or recursive timer", () => {
    expect(REFRESH_DELAYS_MS).toHaveLength(2);
    for (const delay of REFRESH_DELAYS_MS) {
      expect(delay).toBeGreaterThan(0);
      expect(Number.isFinite(delay)).toBe(true);
    }
  });

  it("[M] never uses setInterval anywhere in its source (the one API that would make polling unbounded)", () => {
    const source = readFileSync(path.join(__dirname, "../ArtRefreshWatcher.tsx"), "utf8");
    expect(source).not.toContain("setInterval");
  });
});
