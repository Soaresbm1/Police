import { afterEach, describe, expect, it, vi } from "vitest";
import { browserPageActivity } from "../page-activity";

type Listener = () => void;

function fakeEventTarget() {
  const listeners = new Map<string, Set<Listener>>();
  return {
    addEventListener(type: string, listener: Listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener(type: string, listener: Listener) {
      listeners.get(type)?.delete(listener);
    },
    count: (type: string) => listeners.get(type)?.size ?? 0,
  };
}

function stubPage(initial: { hidden: boolean; focused: boolean }) {
  const state = { ...initial };
  const documentTarget = fakeEventTarget();
  const windowTarget = fakeEventTarget();
  vi.stubGlobal("document", {
    addEventListener: documentTarget.addEventListener,
    removeEventListener: documentTarget.removeEventListener,
    get hidden() {
      return state.hidden;
    },
    hasFocus: () => state.focused,
  });
  vi.stubGlobal("window", windowTarget);
  const listenerCounts = () => [documentTarget.count("visibilitychange"), windowTarget.count("focus"), windowTarget.count("blur")];
  return { state, listenerCounts };
}

describe("browserPageActivity", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("counts the page as active only while it is both visible and focused", () => {
    const page = stubPage({ hidden: false, focused: true });
    expect(browserPageActivity.isActive()).toBe(true);

    page.state.focused = false;
    expect(browserPageActivity.isActive()).toBe(false);

    page.state.hidden = true;
    expect(browserPageActivity.isActive()).toBe(false);

    page.state.focused = true;
    expect(browserPageActivity.isActive()).toBe(false);
  });

  it("listens to visibility and focus changes; each unsubscribe removes exactly its own listeners", () => {
    const page = stubPage({ hidden: false, focused: true });
    const offA = browserPageActivity.subscribe(() => {});
    const offB = browserPageActivity.subscribe(() => {});
    expect(page.listenerCounts()).toEqual([2, 2, 2]);

    offA();
    expect(page.listenerCounts()).toEqual([1, 1, 1]);

    offB();
    expect(page.listenerCounts()).toEqual([0, 0, 0]);
  });

  it("without a DOM (server render) the page is active and subscribing is a no-op", () => {
    expect(typeof document).toBe("undefined");
    expect(browserPageActivity.isActive()).toBe(true);
    const off = browserPageActivity.subscribe(() => {});
    expect(() => off()).not.toThrow();
  });
});
