import { afterEach, describe, expect, it, vi } from "vitest";
import { isUnityCctvEnabled, shouldAttemptUnityCctv, UNITY_CCTV_MIN_VIEWPORT_WIDTH, type UnityCctvCapability } from "../unity-cctv-config";

/**
 * Phase U3 — Canvas fallback decision tests (req. 25). This project has no
 * jsdom/component-test infrastructure (see the Phase 3 report), so the
 * fallback DECISION is deliberately factored into a pure function
 * (`shouldAttemptUnityCctv`) that takes plain booleans rather than reading
 * `window`/`navigator` itself — every case the brief lists (A/B/E) is
 * exercised directly here. Cases C/D/F (loader failure, timeout, runtime
 * load error) are `UnityCCTVPlayer`'s own component-lifecycle behavior —
 * verified by code review (timeout + `.catch()` + `onerror` all call the
 * same `onFallback()` path) and by manual visual QA, since they need a
 * real browser runtime this test suite cannot provide.
 */
function makeCapability(overrides: Partial<UnityCctvCapability> = {}): UnityCctvCapability {
  return {
    flagEnabled: true,
    hasWebAssembly: true,
    hasWebGL2: true,
    isWideEnoughViewport: true,
    ...overrides,
  };
}

describe("shouldAttemptUnityCctv — Canvas fallback decision (req. 25)", () => {
  it("A: Unity disabled by feature flag → Canvas (false)", () => {
    expect(shouldAttemptUnityCctv(makeCapability({ flagEnabled: false }))).toBe(false);
  });

  it("B: unsupported browser (no WebAssembly) → Canvas (false)", () => {
    expect(shouldAttemptUnityCctv(makeCapability({ hasWebAssembly: false }))).toBe(false);
  });

  it("B: unsupported browser (no WebGL2) → Canvas (false)", () => {
    expect(shouldAttemptUnityCctv(makeCapability({ hasWebGL2: false }))).toBe(false);
  });

  it("B: narrow/mobile viewport → Canvas (false) — desktop-only initial rollout", () => {
    expect(shouldAttemptUnityCctv(makeCapability({ isWideEnoughViewport: false }))).toBe(false);
  });

  it("E: every capability present → attempt Unity (true)", () => {
    expect(shouldAttemptUnityCctv(makeCapability())).toBe(true);
  });

  it("is a pure function — same input always yields the same output", () => {
    const cap = makeCapability();
    expect(shouldAttemptUnityCctv(cap)).toBe(shouldAttemptUnityCctv(cap));
  });

  it("requires ALL capabilities simultaneously, not just any one", () => {
    const allFalse: UnityCctvCapability = { flagEnabled: false, hasWebAssembly: false, hasWebGL2: false, isWideEnoughViewport: false };
    expect(shouldAttemptUnityCctv(allFalse)).toBe(false);
  });

  it("the minimum viewport width constant is a sane desktop/tablet breakpoint", () => {
    expect(UNITY_CCTV_MIN_VIEWPORT_WIDTH).toBeGreaterThanOrEqual(600);
    expect(UNITY_CCTV_MIN_VIEWPORT_WIDTH).toBeLessThanOrEqual(1024);
  });
});

describe("isUnityCctvEnabled — feature flag defaults to disabled (req. 12)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to false when the env var is unset — a prod deploy that never sets it stays on Canvas only", () => {
    vi.stubEnv("NEXT_PUBLIC_UNITY_CCTV_ENABLED", "");
    expect(isUnityCctvEnabled()).toBe(false);
  });

  it("requires the exact literal 'true' — any other truthy-looking string stays disabled", () => {
    vi.stubEnv("NEXT_PUBLIC_UNITY_CCTV_ENABLED", "1");
    expect(isUnityCctvEnabled()).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_UNITY_CCTV_ENABLED", "yes");
    expect(isUnityCctvEnabled()).toBe(false);
  });

  it("is true only for the literal string 'true'", () => {
    vi.stubEnv("NEXT_PUBLIC_UNITY_CCTV_ENABLED", "true");
    expect(isUnityCctvEnabled()).toBe(true);
  });
});
