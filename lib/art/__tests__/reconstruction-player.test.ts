import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GAP_TRANSITION_MS } from "@/lib/game-engine/reconstruction/reconstruction-presentation";
import type { ReconstructionScenario } from "@/lib/game-engine/reconstruction/reconstruction-types";
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

    player.seekToTruth(560);
    expect(host.sent.some((m) => m.method === "Seek")).toBe(false);

    const before = host.sent.length;
    host.emit("ready", token, "40440");
    expect(host.methodsAfter(before)).toEqual([`SetHoldPoints(${token}:1560)`, `SetSpeed(${token}:1)`, `Play(${token})`, `Seek(${token}:560)`]);
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

  it("holds on the transition, then seeks straight to the discovery's truth time and resumes", () => {
    host.emit("time", token, "1560|0");
    const before = host.sent.length;
    host.emit("hold", token, "1560");
    expect(player.getSnapshot()).toMatchObject({ transitioning: true, truthTime: 1560 });

    player.togglePlay();
    player.seekToTruth(0);
    vi.advanceTimersByTime(GAP_TRANSITION_MS - 1);
    expect(host.sent.length).toBe(before);

    vi.advanceTimersByTime(1);
    expect(host.methodsAfter(before)).toEqual([`Seek(${token}:39840)`, `Play(${token})`]);
    expect(player.getSnapshot()).toMatchObject({ transitioning: false, truthTime: 39840, playing: true });
  });

  it("closing during the transition cancels the jump", () => {
    host.emit("hold", token, "1560");
    const before = host.sent.length;
    player.unmount();
    vi.advanceTimersByTime(GAP_TRANSITION_MS * 2);
    expect(host.sent.slice(before).some((m) => m.method === "Seek")).toBe(false);
  });

  it("seeking into the gap lands on the discovery", () => {
    const before = host.sent.length;
    player.seekToTruth(20000);
    expect(host.methodsAfter(before)).toEqual([`Seek(${token}:39840)`]);
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
