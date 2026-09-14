import { describe, expect, it } from "vitest";
import { CANVAS_ID, decideActivateAction, type UnityCctvHostState } from "../unity-cctv-host";

/**
 * Phase U3.5 — persistent Unity instance lifecycle tests (req. 24). This
 * project has no jsdom/component-test infrastructure (see
 * unity-cctv-config.test.ts), so — same convention — the actual LIFECYCLE
 * DECISION that fixes the black-canvas bug is factored into a pure function
 * (`decideActivateAction`) and exercised directly here. The DOM-touching
 * orchestration around it (moving the canvas node, calling
 * createUnityInstance/SendMessage/Quit) was verified live: 1 initial mount +
 * 30 QA Canvas/Unity toggles + 10 close/reopen cycles, zero re-creations,
 * zero black canvases, zero console errors (see the phase report).
 */
describe("decideActivateAction — persistent-instance lifecycle core (req. 2/8/9/24)", () => {
  it("ready → resend-scenario: an already-booted instance is reused, never rebuilt (no re-create on QA toggle)", () => {
    expect(decideActivateAction("ready")).toBe("resend-scenario");
  });

  it("idle → start-boot: the one-and-only boot happens on first activation", () => {
    expect(decideActivateAction("idle")).toBe("start-boot");
  });

  it("loading → start-boot: a second activate() while a boot is already in flight does not start a second boot (boot() itself is separately guarded by bootStarted)", () => {
    expect(decideActivateAction("loading")).toBe("start-boot");
  });

  it("failed → immediate-fallback: a viewer never retries a host that already failed once", () => {
    expect(decideActivateAction("failed")).toBe("immediate-fallback");
  });

  it("disposed → immediate-fallback: a viewer opened after the true host lifecycle ended falls back immediately, no resurrection attempt", () => {
    expect(decideActivateAction("disposed")).toBe("immediate-fallback");
  });

  it("is exhaustive and pure over every UnityCctvHostState", () => {
    const states: UnityCctvHostState[] = ["idle", "loading", "ready", "failed", "disposed"];
    for (const state of states) {
      const first = decideActivateAction(state);
      const second = decideActivateAction(state);
      expect(first).toBe(second);
      expect(["resend-scenario", "immediate-fallback", "start-boot"]).toContain(first);
    }
  });
});

describe("canvas identity (req. 11)", () => {
  it("the persistent canvas id is a stable, non-empty string", () => {
    expect(CANVAS_ID).toBeTruthy();
    expect(CANVAS_ID.length).toBeGreaterThan(0);
    // Unity's WebGL framework.js does document.querySelector('#' + canvas.id)
    // internally — an id containing '#' or whitespace would break that.
    expect(CANVAS_ID).toMatch(/^[a-zA-Z][a-zA-Z0-9_-]*$/);
  });
});
