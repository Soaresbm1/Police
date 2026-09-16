import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GAP_TRANSITION_MS } from "@/lib/game-engine/reconstruction/reconstruction-presentation";
import type { ReconstructionScenario } from "@/lib/game-engine/reconstruction/reconstruction-types";
import type { PageActivityPort } from "../page-activity";
import { ReconstructionPlayer, SCENARIO_LOAD_TIMEOUT_MS, type HostLifecycleState, type ReconstructionHostPort } from "../reconstruction-player";
import type { UnityMessage } from "../reconstruction-session";

const poc = JSON.parse(readFileSync("unity/CaselineVisualPrototype/Assets/StreamingAssets/reconstruction-poc-real.json", "utf-8")) as ReconstructionScenario;
const other: ReconstructionScenario = { ...poc, caseId: "other-case" };
const container = {} as HTMLElement;

class FakeHost implements ReconstructionHostPort {
  state: HostLifecycleState = "idle";
  sent: UnityMessage[] = [];
  deactivated = 0;
  resets = 0;
  private listeners = new Set<() => void>();
  private eventListeners = new Set<(type: string, token: number, detail: string) => void>();
  private failureCallbacks: Array<() => void> = [];

  getState = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  attachSurface(_id: symbol, _container: HTMLElement, onFailure: () => void) {
    if (this.state === "failed") onFailure();
    else this.failureCallbacks.push(onFailure);
  }
  deactivate() {
    this.deactivated += 1;
  }
  sendMessage(gameObject: string, method: string, value: string) {
    if (this.state !== "ready") return false;
    this.sent.push({ gameObject, method, value });
    return true;
  }
  onUnityEvent(listener: (type: string, token: number, detail: string) => void) {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }
  resetAfterFailure() {
    this.resets += 1;
    this.state = "idle";
  }

  setState(state: HostLifecycleState) {
    this.state = state;
    if (state === "failed") this.failureCallbacks.splice(0).forEach((cb) => cb());
    this.listeners.forEach((listener) => listener());
  }
  emit(type: string, token: number, detail = "") {
    this.eventListeners.forEach((listener) => listener(type, token, detail));
  }
  loadToken(): number {
    const load = [...this.sent].reverse().find((m) => m.method === "LoadScenario");
    if (!load) throw new Error("no LoadScenario sent");
    return Number(load.value.slice(0, load.value.indexOf(":")));
  }
  methodsAfter(index: number) {
    return this.sent.slice(index).map((m) => `${m.method}(${m.value.includes("{") ? "json" : m.value})`);
  }
}

describe("ReconstructionPlayer — load handshake and races", () => {
  let host: FakeHost;

  beforeEach(() => {
    vi.useFakeTimers();
    host = new FakeHost();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("boots Unity only on mount, then loads once the runtime is ready", () => {
    const player = new ReconstructionPlayer(poc, host);
    expect(host.sent).toEqual([]);
    player.mount(container);
    expect(player.getSnapshot().status).toBe("booting");

    host.setState("ready");
    expect(host.sent.map((m) => m.method)).toEqual(["ActivateReconstruction", "LoadScenario"]);
    expect(player.getSnapshot().status).toBe("loading");
  });

  it("an immediate seek executes only after Unity reports ready, under the same token", () => {
    host.state = "ready";
    const player = new ReconstructionPlayer(poc, host);
    player.mount(container);
    const token = host.loadToken();

    player.seekToTruth(540); // the attack: a moment the presentation plays, so the seek lands on it unchanged
    expect(host.sent.some((m) => m.method === "Seek")).toBe(false);

    const before = host.sent.length;
    host.emit("ready", token, "40440");
    const sent = host.sent.slice(before);
    expect(sent.map((m) => m.method)).toEqual(["SetHoldPoints", "SetSpeed", "Play", "Seek"]);
    expect(sent.every((m) => m.value.startsWith(`${token}`) || m.value === `${token}`)).toBe(true);
    expect(sent[0].value.slice(`${token}:`.length).split(",").map(Number)).toEqual(player.timeline.holdPoints);
    expect(sent[3].value).toBe(`${token}:540`);
    expect(player.getSnapshot().status).toBe("ready");
  });

  it("case A → close → case B: A's queued seek and late ready never act on B", () => {
    host.state = "ready";
    const playerA = new ReconstructionPlayer(poc, host);
    playerA.mount(container);
    const tokenA = host.loadToken();
    playerA.seekToTruth(900);
    playerA.unmount();

    const playerB = new ReconstructionPlayer(other, host);
    playerB.mount(container);
    const tokenB = host.loadToken();
    expect(tokenB).not.toBe(tokenA);

    const before = host.sent.length;
    host.emit("ready", tokenA);
    expect(host.sent.length).toBe(before);

    host.emit("ready", tokenB);
    const afterB = host.sent.slice(before);
    expect(afterB.every((m) => m.value.startsWith(`${tokenB}`))).toBe(true);
    expect(afterB.some((m) => m.method === "Seek")).toBe(false);
    expect(playerA.getSnapshot().status).not.toBe("ready");
  });

  it("a load failure shows the error and sends none of the queued commands", () => {
    host.state = "ready";
    const player = new ReconstructionPlayer(poc, host);
    player.mount(container);
    const token = host.loadToken();
    player.seekToTruth(100);

    const before = host.sent.length;
    host.emit("load_failed", token, "invalid_scenario");
    expect(player.getSnapshot()).toMatchObject({ status: "error", errorKind: "load" });

    host.emit("ready", token);
    expect(host.sent.length).toBe(before);
  });

  it("closing during loading: the ready that follows neither notifies the viewer nor sends anything", () => {
    host.state = "ready";
    const player = new ReconstructionPlayer(poc, host);
    const listener = vi.fn();
    player.subscribe(listener);
    player.mount(container);
    const token = host.loadToken();
    player.unmount();
    listener.mockClear();

    const before = host.sent.length;
    host.emit("ready", token);
    expect(host.sent.length).toBe(before);
    expect(listener).not.toHaveBeenCalled();
    expect(host.deactivated).toBe(1);
  });

  it("a load that never reports back fails instead of spinning forever", () => {
    host.state = "ready";
    const player = new ReconstructionPlayer(poc, host);
    player.mount(container);
    vi.advanceTimersByTime(SCENARIO_LOAD_TIMEOUT_MS);
    expect(player.getSnapshot()).toMatchObject({ status: "error", errorKind: "load" });
  });

  it("retry after a load failure starts a fresh load with a new token", () => {
    host.state = "ready";
    const player = new ReconstructionPlayer(poc, host);
    player.mount(container);
    const first = host.loadToken();
    host.emit("load_failed", first, "invalid_scenario");

    player.retry();
    const second = host.loadToken();
    expect(second).not.toBe(first);
    host.emit("ready", second);
    expect(player.getSnapshot().status).toBe("ready");
  });

  it("a failed Unity boot shows the error; retry resets the host and boots again", () => {
    const player = new ReconstructionPlayer(poc, host);
    player.mount(container);
    host.setState("failed");
    expect(player.getSnapshot()).toMatchObject({ status: "error", errorKind: "boot" });

    player.retry();
    expect(host.resets).toBe(1);
    expect(player.getSnapshot().status).toBe("booting");
    host.setState("ready");
    expect(player.getSnapshot().status).toBe("loading");
  });
});

describe("ReconstructionPlayer — Plus tard… transition", () => {
  let host: FakeHost;
  let player: ReconstructionPlayer;
  let token: number;

  beforeEach(() => {
    vi.useFakeTimers();
    host = new FakeHost();
    host.state = "ready";
    player = new ReconstructionPlayer(poc, host);
    player.mount(container);
    token = host.loadToken();
    host.emit("ready", token);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("holds on the transition, then seeks straight to the next moment that shows something and resumes", () => {
    const hold = player.timeline.holdPoints[0];
    const landsOn = player.timeline.segments.find((s) => s.kind === "gap" && s.truthStart === hold)!.truthEnd;
    host.emit("time", token, `${hold}|0`);
    const before = host.sent.length;
    host.emit("hold", token, String(hold));
    expect(player.getSnapshot()).toMatchObject({ transitioning: true, truthTime: hold });

    player.togglePlay();
    player.seekToTruth(0);
    vi.advanceTimersByTime(GAP_TRANSITION_MS - 1);
    expect(host.sent.length).toBe(before);

    vi.advanceTimersByTime(1);
    expect(host.methodsAfter(before)).toEqual([`Seek(${token}:${landsOn})`, `Play(${token})`]);
    expect(player.getSnapshot()).toMatchObject({ transitioning: false, truthTime: landsOn, playing: true });
  });

  it("closing during the transition cancels the jump", () => {
    host.emit("hold", token, String(player.timeline.holdPoints[0]));
    const before = host.sent.length;
    player.unmount();
    vi.advanceTimersByTime(GAP_TRANSITION_MS * 2);
    expect(host.sent.slice(before).some((m) => m.method === "Seek")).toBe(false);
  });

  it("seeking into a gap lands on the far side of it", () => {
    const gap = player.timeline.segments.find((s) => s.kind === "gap")!;
    const before = host.sent.length;
    player.seekToTruth((gap.truthStart + gap.truthEnd) / 2);
    expect(host.methodsAfter(before)).toEqual([`Seek(${token}:${gap.truthEnd})`]);
  });

  it("a hold that is not a known gap start is ignored", () => {
    host.emit("hold", token, "777");
    expect(player.getSnapshot().transitioning).toBe(false);
  });

  it("ignores playback events carrying another token", () => {
    host.emit("time", token + 1000, "999|1");
    expect(player.getSnapshot().truthTime).toBe(0);
  });

  it("pauses Unity when the viewer closes", () => {
    const before = host.sent.length;
    player.unmount();
    expect(host.methodsAfter(before)).toEqual([`Pause(${token})`]);
  });
});

class FakePageActivity implements PageActivityPort {
  active = true;
  private listeners = new Set<() => void>();

  isActive = () => this.active;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  set(active: boolean) {
    this.active = active;
    this.listeners.forEach((listener) => listener());
  }
  get listenerCount() {
    return this.listeners.size;
  }
}

describe("ReconstructionPlayer — the load timeout only counts time the page is active", () => {
  const SECOND = 1000;
  let host: FakeHost;
  let page: FakePageActivity;
  let statuses: string[];

  const mountPlayer = (scenario: ReconstructionScenario = poc) => {
    const player = new ReconstructionPlayer(scenario, host, page);
    player.subscribe(() => statuses.push(player.getSnapshot().status));
    player.mount(container);
    return player;
  };
  const timeouts = () => statuses.filter((status, i) => status === "error" && statuses[i - 1] !== "error").length;

  beforeEach(() => {
    vi.useFakeTimers();
    host = new FakeHost();
    host.state = "ready";
    page = new FakePageActivity();
    statuses = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("A: 20 s of visible loading without a reply times out", () => {
    const player = mountPlayer();
    vi.advanceTimersByTime(SCENARIO_LOAD_TIMEOUT_MS - 1);
    expect(player.getSnapshot().status).toBe("loading");

    vi.advanceTimersByTime(1);
    expect(player.getSnapshot()).toMatchObject({ status: "error", errorKind: "load" });
    expect(timeouts()).toBe(1);
  });

  it("B: time spent hidden does not count — 10 s visible, 30 s hidden, 9 s visible is still loading", () => {
    const player = mountPlayer();
    vi.advanceTimersByTime(10 * SECOND);
    page.set(false);
    vi.advanceTimersByTime(30 * SECOND);
    page.set(true);
    vi.advanceTimersByTime(9 * SECOND);
    expect(player.getSnapshot().status).toBe("loading");
  });

  it("C: the remaining visible budget then expires, exactly once, leaving nothing behind", () => {
    const player = mountPlayer();
    vi.advanceTimersByTime(10 * SECOND);
    page.set(false);
    vi.advanceTimersByTime(30 * SECOND);
    page.set(true);
    vi.advanceTimersByTime(10 * SECOND - 1);
    expect(player.getSnapshot().status).toBe("loading");

    vi.advanceTimersByTime(1);
    expect(player.getSnapshot()).toMatchObject({ status: "error", errorKind: "load" });

    page.set(false);
    page.set(true);
    vi.advanceTimersByTime(60 * SECOND);
    expect(timeouts()).toBe(1);
    expect(page.listenerCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("visibility changes never restart the budget", () => {
    const player = mountPlayer();
    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(5 * SECOND);
      page.set(false);
      page.set(true);
    }
    vi.advanceTimersByTime(5 * SECOND);
    expect(player.getSnapshot().status).toBe("error");
    expect(timeouts()).toBe(1);
  });

  it("a load that starts while the page is inactive waits for it before counting", () => {
    page.active = false;
    const player = mountPlayer();
    vi.advanceTimersByTime(120 * SECOND);
    expect(player.getSnapshot().status).toBe("loading");

    page.set(true);
    vi.advanceTimersByTime(SCENARIO_LOAD_TIMEOUT_MS);
    expect(player.getSnapshot().status).toBe("error");
  });

  it("D: ready while visible cancels the timeout", () => {
    const player = mountPlayer();
    vi.advanceTimersByTime(15 * SECOND);
    host.emit("ready", host.loadToken());
    expect(page.listenerCount).toBe(0);

    page.set(false);
    page.set(true);
    vi.advanceTimersByTime(60 * SECOND);
    expect(player.getSnapshot().status).toBe("ready");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("E: closing while hidden leaves no timeout or listener behind", () => {
    const player = mountPlayer();
    vi.advanceTimersByTime(5 * SECOND);
    page.set(false);
    player.unmount();

    page.set(true);
    vi.advanceTimersByTime(60 * SECOND);
    expect(statuses).not.toContain("error");
    expect(page.listenerCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("F: retry starts a fresh 20 s active budget", () => {
    const player = mountPlayer();
    vi.advanceTimersByTime(15 * SECOND);
    page.set(false);
    host.emit("load_failed", host.loadToken(), "invalid_scenario");
    expect(page.listenerCount).toBe(0);

    page.set(true);
    player.retry();
    expect(player.getSnapshot().status).toBe("loading");
    expect(page.listenerCount).toBe(1);
    vi.advanceTimersByTime(SCENARIO_LOAD_TIMEOUT_MS - 1);
    expect(player.getSnapshot().status).toBe("loading");

    vi.advanceTimersByTime(1);
    expect(player.getSnapshot()).toMatchObject({ status: "error", errorKind: "load" });
  });

  it("G: a replaced hidden load can neither time out nor listen on behalf of the next one", () => {
    const playerA = mountPlayer();
    vi.advanceTimersByTime(15 * SECOND);
    page.set(false);
    playerA.unmount();

    const playerB = new ReconstructionPlayer(other, host, page);
    playerB.mount(container);
    expect(page.listenerCount).toBe(1);

    page.set(true);
    vi.advanceTimersByTime(19 * SECOND);
    expect(playerB.getSnapshot().status).toBe("loading");
    expect(playerA.getSnapshot().status).toBe("loading");

    vi.advanceTimersByTime(SECOND);
    expect(playerB.getSnapshot()).toMatchObject({ status: "error", errorKind: "load" });
    expect(playerA.getSnapshot().status).toBe("loading");
    expect(page.listenerCount).toBe(0);
  });

  it("H: stale ready and error events stay ignored around a timeout and a retry", () => {
    const player = mountPlayer();
    const first = host.loadToken();
    vi.advanceTimersByTime(SCENARIO_LOAD_TIMEOUT_MS);

    const before = host.sent.length;
    host.emit("ready", first);
    expect(player.getSnapshot().status).toBe("error");
    expect(host.sent.length).toBe(before);

    player.retry();
    const second = host.loadToken();
    host.emit("load_failed", first, "invalid_scenario");
    host.emit("ready", first);
    expect(player.getSnapshot().status).toBe("loading");

    host.emit("ready", second);
    vi.advanceTimersByTime(60 * SECOND);
    expect(player.getSnapshot().status).toBe("ready");
    expect(timeouts()).toBe(1);
  });
});
