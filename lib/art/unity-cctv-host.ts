import type { UnityCCTVScenario } from "./unity-cctv-bridge";

/**
 * Phase U3.5 — page-level singleton owning the Unity WebGL instance.
 *
 * Root cause of the U3 "black canvas on remount" bug (confirmed via console
 * trace): each `UnityCCTVPlayer` mount created its own `<canvas>` and called
 * `createUnityInstance()`, and unmount called the previous instance's
 * `Quit()` — which returns a Promise that is not awaited by anything.
 * Toggling Canvas/Unity or closing/reopening a clip could therefore start a
 * SECOND Unity WASM engine booting (new WebGL context, new Physics module)
 * before the FIRST engine's async teardown had actually finished. The two
 * engines' boot/teardown sequences interleaved, and the second instance's
 * `createUnityInstance()` promise still resolved — but its render loop
 * never produced a visible frame.
 *
 * Fix: never call `createUnityInstance()` more than once per page session.
 * One canvas element, one Unity instance, created lazily on first use and
 * kept alive for the lifetime of the host (see `disposeHost()` — called
 * only when the true host lifecycle ends, e.g. the Cameras app unmounting).
 * `activate()`/`deactivate()` just move the persistent canvas node into (or
 * hide it from) whichever viewer currently wants to show it — moving a
 * `<canvas>` between DOM parents does not lose its WebGL context, unlike
 * destroying and recreating the element.
 */

const LOADER_SRC = "/unity/cctv/Build/WebBuild.loader.js";
const BUILD_BASE = "/unity/cctv/Build";
const LOAD_TIMEOUT_MS = 12_000;
const BRIDGE_GAME_OBJECT = "WebBridge";
export const CANVAS_ID = "unity-cctv-canvas";

export type UnityCctvHostState = "idle" | "loading" | "ready" | "failed" | "disposed";

export type ActivateAction = "resend-scenario" | "immediate-fallback" | "start-boot";

/**
 * Pure decision core of `activate()` — factored out so the lifecycle rules
 * this phase exists to fix ("no re-create on QA Canvas toggle", "same Unity
 * instance reused", "failed initial boot still falls back") are unit
 * testable without a DOM (this project's Vitest config runs in a plain node
 * environment — see unity-cctv-config.test.ts for the same convention).
 * The stateful `activate()` method below does nothing but call this and act
 * on the result.
 */
export function decideActivateAction(state: UnityCctvHostState): ActivateAction {
  if (state === "failed" || state === "disposed") return "immediate-fallback";
  if (state === "ready") return "resend-scenario";
  return "start-boot";
}

interface UnityInstanceHandle {
  SendMessage: (gameObject: string, method: string, value: string) => void;
  Quit: () => Promise<void>;
}

declare global {
  interface Window {
    createUnityInstance?: (
      canvas: HTMLCanvasElement,
      config: Record<string, string>,
      onProgress?: (progress: number) => void,
    ) => Promise<UnityInstanceHandle>;
  }
}

type Listener = () => void;
type ConsumerId = symbol;

class UnityCctvHost {
  private canvas: HTMLCanvasElement | null = null;
  private instance: UnityInstanceHandle | null = null;
  private state: UnityCctvHostState = "idle";
  private listeners = new Set<Listener>();
  private loaderPromise: Promise<void> | null = null;
  private bootStarted = false;
  /** Bumped on dispose so a late-resolving createUnityInstance() from a prior
   * (disposed) host generation can be detected and discarded (req. 9). */
  private generation = 0;
  private activeConsumerId: ConsumerId | null = null;
  private pendingScenarioJson: string | null = null;
  private pendingFallbacks = new Set<() => void>();

  getState = (): UnityCctvHostState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit() {
    this.listeners.forEach((listener) => listener());
  }

  private setState(next: UnityCctvHostState) {
    if (this.state === next) return;
    this.state = next;
    this.emit();
  }

  private ensureCanvas(): HTMLCanvasElement {
    if (!this.canvas) {
      const canvas = document.createElement("canvas");
      canvas.id = CANVAS_ID;
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      canvas.style.display = "block";
      this.canvas = canvas;
    }
    return this.canvas;
  }

  private loadLoaderScript(): Promise<void> {
    if (typeof window !== "undefined" && typeof window.createUnityInstance === "function") {
      return Promise.resolve();
    }
    if (this.loaderPromise) return this.loaderPromise;

    this.loaderPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>(`script[src="${LOADER_SRC}"]`);
      if (existing) {
        if (typeof window.createUnityInstance === "function") {
          resolve();
          return;
        }
        existing.addEventListener("load", () => resolve());
        existing.addEventListener("error", () => reject(new Error("Unity loader script failed to load")));
        return;
      }
      const script = document.createElement("script");
      script.src = LOADER_SRC;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Unity loader script failed to load"));
      document.body.appendChild(script);
    });
    return this.loaderPromise;
  }

  private fail() {
    this.setState("failed");
    this.pendingFallbacks.forEach((cb) => cb());
    this.pendingFallbacks.clear();
  }

  /** Boots the ONE Unity instance this host will ever create. No-op if a
   * boot already started (loading/ready/failed all short-circuit here). */
  private boot() {
    if (this.bootStarted) return;
    this.bootStarted = true;
    this.setState("loading");
    const generation = this.generation;
    const timeoutId = setTimeout(() => {
      if (generation === this.generation && this.state === "loading") this.fail();
    }, LOAD_TIMEOUT_MS);

    this.loadLoaderScript()
      .then(() => {
        if (generation !== this.generation) return null;
        if (typeof window.createUnityInstance !== "function") throw new Error("createUnityInstance unavailable");
        const canvas = this.ensureCanvas();
        return window.createUnityInstance(canvas, {
          dataUrl: `${BUILD_BASE}/WebBuild.data`,
          frameworkUrl: `${BUILD_BASE}/WebBuild.framework.js`,
          codeUrl: `${BUILD_BASE}/WebBuild.wasm`,
          companyName: "CASELINE",
          productName: "CCTV Viewer",
          productVersion: "1.0",
        });
      })
      .then((instance) => {
        if (!instance) return;
        clearTimeout(timeoutId);
        if (generation !== this.generation) {
          // Host was disposed while this boot was in flight — never keep a
          // second engine alive.
          instance.Quit().catch(() => {});
          return;
        }
        this.instance = instance;
        this.setState("ready");
        this.pendingFallbacks.clear();
        if (this.pendingScenarioJson) this.sendScenario(this.pendingScenarioJson);
      })
      .catch(() => {
        clearTimeout(timeoutId);
        if (generation === this.generation) this.fail();
      });
  }

  private sendScenario(json: string) {
    if (!this.instance) return;
    this.pendingScenarioJson = json;
    this.instance.SendMessage(BRIDGE_GAME_OBJECT, "LoadScenarioJson", json);
  }

  /**
   * A viewer wants to show Unity in `container` with `scenario`. Reuses the
   * existing instance if one is already ready (just moves the canvas and
   * restarts the scenario at t=0, per req. 12 — no engine recreation);
   * otherwise starts the one-and-only boot. Immediately reports failure to
   * `onFallback` if the host already failed once — never retried per viewer.
   */
  activate(consumerId: ConsumerId, container: HTMLElement, scenario: UnityCCTVScenario, onFallback: () => void): void {
    this.activeConsumerId = consumerId;
    const json = JSON.stringify(scenario);
    const action = decideActivateAction(this.state);

    if (action === "immediate-fallback") {
      onFallback();
      return;
    }

    const canvas = this.ensureCanvas();
    if (canvas.parentElement !== container) container.appendChild(canvas);
    canvas.style.display = "block";

    if (action === "resend-scenario") {
      this.sendScenario(json);
      return;
    }

    this.pendingScenarioJson = json;
    this.pendingFallbacks.add(onFallback);
    this.boot();
  }

  /** Viewer no longer wants to show Unity (toggled to Canvas, or closed).
   * Hides the canvas but keeps the instance alive — this is the entire fix:
   * no Quit(), no createUnityInstance() happens here. */
  deactivate(consumerId: ConsumerId): void {
    if (this.activeConsumerId !== consumerId) return;
    this.activeConsumerId = null;
    if (this.canvas) this.canvas.style.display = "none";
  }

  /** True host-lifecycle end (e.g. the Cameras app unmounting) — the only
   * place Quit() is called. */
  disposeHost(): void {
    this.generation += 1;
    this.bootStarted = false;
    this.pendingFallbacks.clear();
    this.pendingScenarioJson = null;
    this.activeConsumerId = null;
    if (this.instance) {
      this.instance.Quit().catch(() => {});
      this.instance = null;
    }
    this.canvas?.remove();
    this.canvas = null;
    this.setState("disposed");
  }

  private disposeTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Debounced disposal — the host's owner (CamerasApp) calls this from its
   * unmount cleanup instead of `disposeHost()` directly. React 18 dev-mode
   * StrictMode intentionally mounts every component, runs its cleanup, then
   * mounts it again (to surface exactly this class of external-resource
   * bug) — a same-tick remount cancels the scheduled dispose via
   * `cancelScheduledDispose()`, so the synthetic StrictMode cleanup never
   * actually tears down a live Unity instance. Only a genuine, lasting
   * unmount (the Cameras app really going away) lets the timer fire.
   */
  scheduleDispose(): void {
    if (this.disposeTimer) clearTimeout(this.disposeTimer);
    this.disposeTimer = setTimeout(() => {
      this.disposeTimer = null;
      this.disposeHost();
    }, 0);
  }

  cancelScheduledDispose(): void {
    if (this.disposeTimer) {
      clearTimeout(this.disposeTimer);
      this.disposeTimer = null;
    }
  }
}

export const unityCctvHost = new UnityCctvHost();
