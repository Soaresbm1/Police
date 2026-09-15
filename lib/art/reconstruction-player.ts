import {
  barToTruth,
  buildPresentationTimeline,
  gapAtHold,
  GAP_TRANSITION_MS,
  snapOutOfGap,
  type PresentationTimeline,
} from "@/lib/game-engine/reconstruction/reconstruction-presentation";
import type { ReconstructionScenario } from "@/lib/game-engine/reconstruction/reconstruction-types";
import { browserPageActivity, type PageActivityPort } from "./page-activity";
import {
  allocateReconstructionToken,
  beginLoad,
  closeSession,
  createSession,
  enqueue,
  parseTimeDetail,
  receiveEvent,
  type ReconstructionCommand,
  type ReconstructionSession,
  type UnityMessage,
} from "./reconstruction-session";

export type HostLifecycleState = "idle" | "loading" | "ready" | "failed" | "disposed";

/** The slice of the shared Unity host the reconstruction viewer uses. */
export interface ReconstructionHostPort {
  getState(): HostLifecycleState;
  subscribe(listener: () => void): () => void;
  attachSurface(consumerId: symbol, container: HTMLElement, onFailure: () => void): void;
  deactivate(consumerId: symbol): void;
  sendMessage(gameObject: string, method: string, value: string): boolean;
  onUnityEvent(listener: (type: string, token: number, detail: string) => void): () => void;
  resetAfterFailure(): void;
}

export type PlayerStatus = "booting" | "loading" | "ready" | "error";

export interface PlayerSnapshot {
  status: PlayerStatus;
  errorKind: "boot" | "load" | null;
  playing: boolean;
  truthTime: number;
  speed: number;
  /** "Plus tard…" is on screen; controls wait for it to finish. */
  transitioning: boolean;
  ended: boolean;
}

/** A load that never reports back is a failure, not a guess at readiness. Counted in active page time only. */
export const SCENARIO_LOAD_TIMEOUT_MS = 20_000;

/**
 * Drives one reconstruction viewing: boots or reuses the shared Unity runtime, loads the scenario through the
 * token handshake, and turns Unity's truth-time events into the presentation the player sees, including the
 * compressed "Plus tard…" gap. Framework-free so its race handling is unit tested; React only subscribes to it.
 */
export class ReconstructionPlayer {
  readonly timeline: PresentationTimeline;

  private readonly scenarioJson: string;
  private readonly consumerId = Symbol("reconstruction-viewer");
  private session: ReconstructionSession = createSession();
  private snapshot: PlayerSnapshot = { status: "booting", errorKind: null, playing: false, truthTime: 0, speed: 1, transitioning: false, ended: false };
  private readonly listeners = new Set<() => void>();
  private container: HTMLElement | null = null;
  private unsubscribeHost: (() => void) | null = null;
  private unsubscribeEvents: (() => void) | null = null;
  private transitionTimer: ReturnType<typeof setTimeout> | null = null;
  private loadTimer: ReturnType<typeof setTimeout> | null = null;
  /** Active page time the current load may still take, and when the running stretch of it started. */
  private loadBudgetMs = 0;
  private loadBudgetSince = 0;
  private unsubscribeActivity: (() => void) | null = null;

  constructor(
    scenario: ReconstructionScenario,
    private readonly host: ReconstructionHostPort,
    private readonly activity: PageActivityPort = browserPageActivity,
  ) {
    this.timeline = buildPresentationTimeline(scenario);
    this.scenarioJson = JSON.stringify(scenario);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): PlayerSnapshot => this.snapshot;

  mount(container: HTMLElement): void {
    if (this.container) return;
    this.container = container;
    this.session = createSession();
    this.update({ status: "booting", errorKind: null, playing: false, truthTime: 0, transitioning: false, ended: false });
    this.unsubscribeEvents = this.host.onUnityEvent(this.handleUnityEvent);
    this.unsubscribeHost = this.host.subscribe(this.handleHostState);
    this.host.attachSurface(this.consumerId, container, this.handleBootFailure);
    this.handleHostState();
  }

  unmount(): void {
    if (!this.container) return;
    if (this.session.phase === "ready") this.send(enqueue(this.session, { kind: "pause" }).messages);
    this.session = closeSession(this.session);
    this.clearTimers();
    this.unsubscribeEvents?.();
    this.unsubscribeHost?.();
    this.unsubscribeEvents = null;
    this.unsubscribeHost = null;
    this.host.deactivate(this.consumerId);
    this.container = null;
  }

  togglePlay(): void {
    if (!this.canControl()) return;
    if (this.snapshot.playing) {
      this.queue({ kind: "pause" });
      this.update({ playing: false });
      return;
    }
    if (this.snapshot.ended || this.snapshot.truthTime >= this.timeline.truthDuration) {
      this.queue({ kind: "seek", time: 0 });
      this.update({ truthTime: 0 });
    }
    this.queue({ kind: "play" });
    this.update({ playing: true, ended: false });
  }

  restart(): void {
    if (!this.canControl()) return;
    this.queue({ kind: "restart" });
    this.update({ truthTime: 0, playing: true, ended: false });
  }

  setSpeed(speed: number): void {
    this.update({ speed });
    this.queue({ kind: "setSpeed", speed });
  }

  seekToTruth(truthTime: number): void {
    if (!this.canControl()) return;
    const target = snapOutOfGap(this.timeline, Math.min(this.timeline.truthDuration, Math.max(0, truthTime)));
    this.queue({ kind: "seek", time: target });
    this.update({ truthTime: target, ended: false });
  }

  seekToBar(barPosition: number): void {
    this.seekToTruth(barToTruth(this.timeline, barPosition));
  }

  retry(): void {
    const container = this.container;
    if (!container) return;
    this.clearTimers();
    this.session = createSession();
    this.update({ status: "booting", errorKind: null, playing: false, transitioning: false, ended: false });
    if (this.host.getState() === "failed") {
      this.host.resetAfterFailure();
      this.host.attachSurface(this.consumerId, container, this.handleBootFailure);
    }
    this.handleHostState();
  }

  private canControl(): boolean {
    return this.container !== null && (this.session.phase === "ready" || this.session.phase === "loading") && !this.snapshot.transitioning;
  }

  private handleHostState = (): void => {
    if (!this.container) return;
    const state = this.host.getState();
    if (state === "failed") {
      this.handleBootFailure();
      return;
    }
    if (state === "ready" && this.session.phase === "idle") this.startLoad();
  };

  private handleBootFailure = (): void => {
    if (!this.container || this.snapshot.errorKind === "boot") return;
    this.clearTimers();
    this.session = closeSession(this.session);
    this.update({ status: "error", errorKind: "boot", playing: false, transitioning: false });
  };

  private startLoad(): void {
    const step = beginLoad(this.scenarioJson, allocateReconstructionToken());
    this.session = step.session;
    this.send(step.messages);
    this.queue({ kind: "setHoldPoints", points: this.timeline.holdPoints });
    this.queue({ kind: "setSpeed", speed: this.snapshot.speed });
    this.queue({ kind: "play" });
    this.update({ status: "loading", errorKind: null, playing: false, truthTime: 0, transitioning: false, ended: false });
    this.startLoadTimeout(this.session.token);
  }

  /**
   * Unity cannot progress while the page is hidden or unfocused (runInBackground is off), so the deadline counts
   * active page time only: it pauses with the page and resumes with whatever budget was left, never a fresh one.
   */
  private startLoadTimeout(token: number): void {
    this.clearLoadTimer();
    this.loadBudgetMs = SCENARIO_LOAD_TIMEOUT_MS;
    this.unsubscribeActivity = this.activity.subscribe(() => this.syncLoadTimeout(token));
    this.syncLoadTimeout(token);
  }

  private syncLoadTimeout(token: number): void {
    if (this.session.token !== token || this.session.phase !== "loading") return;
    const active = this.activity.isActive();
    if (active && this.loadTimer === null) {
      this.loadBudgetSince = Date.now();
      this.loadTimer = setTimeout(() => {
        this.loadTimer = null;
        if (this.session.token === token && this.session.phase === "loading") this.failLoad();
      }, this.loadBudgetMs);
    } else if (!active && this.loadTimer !== null) {
      clearTimeout(this.loadTimer);
      this.loadTimer = null;
      this.loadBudgetMs = Math.max(0, this.loadBudgetMs - (Date.now() - this.loadBudgetSince));
    }
  }

  private failLoad(): void {
    this.clearTimers();
    this.session = { ...closeSession(this.session), phase: "error" };
    this.update({ status: "error", errorKind: "load", playing: false, transitioning: false });
  }

  private handleUnityEvent = (type: string, token: number, detail: string): void => {
    if (!this.container) return;
    const result = receiveEvent(this.session, type, token, detail);
    if (!result.accepted) return;
    this.session = result.session;

    switch (type) {
      case "ready":
        this.clearLoadTimer();
        this.update({ status: "ready" });
        this.send(result.messages);
        break;
      case "load_failed":
        this.failLoad();
        break;
      case "time": {
        const { time, playing } = parseTimeDetail(detail);
        this.update({ truthTime: time, playing });
        break;
      }
      case "hold":
        this.beginGapTransition(Number(detail));
        break;
      case "ended":
        this.update({ playing: false, ended: true });
        break;
    }
  };

  private beginGapTransition(holdTime: number): void {
    const gap = gapAtHold(this.timeline, holdTime);
    if (!gap) return;
    const token = this.session.token;
    this.clearTransitionTimer();
    this.update({ transitioning: true, playing: false, truthTime: holdTime });
    this.transitionTimer = setTimeout(() => {
      this.transitionTimer = null;
      if (!this.container || this.session.token !== token || this.session.phase !== "ready") return;
      this.queue({ kind: "seek", time: gap.truthEnd });
      this.queue({ kind: "play" });
      this.update({ transitioning: false, truthTime: gap.truthEnd, playing: true });
    }, GAP_TRANSITION_MS);
  }

  private queue(command: ReconstructionCommand): void {
    const step = enqueue(this.session, command);
    this.session = step.session;
    this.send(step.messages);
  }

  private send(messages: UnityMessage[]): void {
    for (const message of messages) this.host.sendMessage(message.gameObject, message.method, message.value);
  }

  private update(patch: Partial<PlayerSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  private clearLoadTimer(): void {
    if (this.loadTimer) clearTimeout(this.loadTimer);
    this.loadTimer = null;
    this.unsubscribeActivity?.();
    this.unsubscribeActivity = null;
  }

  private clearTransitionTimer(): void {
    if (this.transitionTimer) clearTimeout(this.transitionTimer);
    this.transitionTimer = null;
  }

  private clearTimers(): void {
    this.clearLoadTimer();
    this.clearTransitionTimer();
  }
}
