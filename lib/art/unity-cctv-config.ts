/**
 * Phase U3 — feature flag + pure capability/fallback logic for the embedded
 * Unity CCTV renderer. Kept as small, dependency-free, testable functions
 * (no DOM reads inside the pure part) so the fallback DECISION itself can
 * be unit-tested without a browser — this project has no
 * jsdom/React-Testing-Library setup (see the Phase 3 report), so any logic
 * that needs coverage has to be expressible as a plain function like this
 * one, with the actual `window`/`navigator` reads kept in a thin, separate,
 * un-tested wrapper (`detectUnityCctvCapability`).
 */

/** Public, non-secret boolean flag only — never a URL, key, or anything
 * that shouldn't ship to every visitor's browser. Defaults to disabled: a
 * production deploy that never sets this env var gets the existing Canvas
 * renderer only, exactly as before this phase — Unity is opt-in, never
 * silently on. */
export function isUnityCctvEnabled(): boolean {
  return process.env.NEXT_PUBLIC_UNITY_CCTV_ENABLED === "true";
}

export interface UnityCctvCapability {
  flagEnabled: boolean;
  hasWebAssembly: boolean;
  hasWebGL2: boolean;
  /** False on narrow/mobile viewports — Unity WebGL is gated to desktop
   * widths for this initial rollout (req. 15); Canvas already looks fine
   * and is far lighter on a phone. */
  isWideEnoughViewport: boolean;
}

/** Pure decision: every capability must hold for Unity to even be
 * attempted. A `false` here means "go straight to Canvas, don't even try
 * loading the Unity runtime" — this is checked BEFORE any script injection
 * happens, so an unsupported/narrow browser never pays any Unity loading
 * cost at all (still lazy — see `UnityCCTVPlayer`, which is itself only
 * ever mounted when this already returned true). */
export function shouldAttemptUnityCctv(capability: UnityCctvCapability): boolean {
  return capability.flagEnabled && capability.hasWebAssembly && capability.hasWebGL2 && capability.isWideEnoughViewport;
}

/** Minimum viewport width Unity is attempted at — matches the app's own
 * existing tablet/desktop breakpoint convention, not a Unity-specific
 * number picked in isolation. */
export const UNITY_CCTV_MIN_VIEWPORT_WIDTH = 768;

/** The one impure boundary — reads `window`/`navigator`/env directly.
 * Never called during SSR (guarded by `typeof window` itself); every
 * actual decision still funnels through the pure `shouldAttemptUnityCctv`
 * above so that function stays the single source of truth and the one
 * thing tests exercise. */
export function detectUnityCctvCapability(): UnityCctvCapability {
  if (typeof window === "undefined") {
    return { flagEnabled: false, hasWebAssembly: false, hasWebGL2: false, isWideEnoughViewport: false };
  }

  const hasWebAssembly = typeof WebAssembly === "object" && typeof WebAssembly.instantiate === "function";

  let hasWebGL2 = false;
  try {
    const canvas = document.createElement("canvas");
    hasWebGL2 = Boolean(canvas.getContext("webgl2"));
  } catch {
    hasWebGL2 = false;
  }

  return {
    flagEnabled: isUnityCctvEnabled(),
    hasWebAssembly,
    hasWebGL2,
    isWideEnoughViewport: window.innerWidth >= UNITY_CCTV_MIN_VIEWPORT_WIDTH,
  };
}
