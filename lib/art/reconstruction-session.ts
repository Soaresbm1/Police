/**
 * Host-side load handshake for the Unity reconstruction, as a pure state machine.
 *
 * Each scenario load gets a token. Unity reports "ready" (or "load_failed") for that token once the scene is
 * actually built; commands issued before that are queued, then flushed in order. Anything carrying another token
 * — a late event from a previous load, or a command meant for it — is dropped, on both sides of the bridge.
 */

export const RECONSTRUCTION_BRIDGE_OBJECT = "ReconstructionWebBridge";
export const EMBED_MODE_OBJECT = "EmbedMode";

export type ReconstructionCommand =
  | { kind: "setHoldPoints"; points: number[] }
  | { kind: "seek"; time: number }
  | { kind: "play" }
  | { kind: "pause" }
  | { kind: "restart" }
  | { kind: "setSpeed"; speed: number };

export interface UnityMessage {
  gameObject: string;
  method: string;
  value: string;
}

export type SessionPhase = "idle" | "loading" | "ready" | "error" | "closed";

export interface ReconstructionSession {
  readonly phase: SessionPhase;
  readonly token: number;
  readonly queue: readonly ReconstructionCommand[];
  readonly errorCode: string | null;
}

export interface SessionStep {
  session: ReconstructionSession;
  messages: UnityMessage[];
}

export interface SessionEventResult extends SessionStep {
  accepted: boolean;
}

let lastToken = 0;

/** Tokens are unique for the page's lifetime, so two viewers can never share one. */
export function allocateReconstructionToken(): number {
  lastToken += 1;
  return lastToken;
}

export function createSession(): ReconstructionSession {
  return { phase: "idle", token: 0, queue: [], errorCode: null };
}

export function beginLoad(scenarioJson: string, token: number): SessionStep {
  return {
    session: { phase: "loading", token, queue: [], errorCode: null },
    messages: [
      { gameObject: EMBED_MODE_OBJECT, method: "ActivateReconstruction", value: "" },
      { gameObject: RECONSTRUCTION_BRIDGE_OBJECT, method: "LoadScenario", value: `${token}:${scenarioJson}` },
    ],
  };
}

export function enqueue(session: ReconstructionSession, command: ReconstructionCommand): SessionStep {
  if (session.phase === "ready") return { session, messages: [commandMessage(session.token, command)] };
  if (session.phase !== "loading") return { session, messages: [] };
  return { session: { ...session, queue: coalesce(session.queue, command) }, messages: [] };
}

export function receiveEvent(session: ReconstructionSession, type: string, token: number, detail: string): SessionEventResult {
  const unchanged = { session, messages: [], accepted: false };

  // A malformed LoadScenario is reported without a token; only the load in flight can have caused it.
  if (type === "load_failed" && session.phase === "loading" && (token === session.token || token === -1)) {
    return { session: { ...session, phase: "error", queue: [], errorCode: detail || "unknown" }, messages: [], accepted: true };
  }
  if (token !== session.token) return unchanged;

  if (type === "ready") {
    if (session.phase !== "loading") return unchanged;
    return {
      session: { ...session, phase: "ready", queue: [] },
      messages: session.queue.map((command) => commandMessage(session.token, command)),
      accepted: true,
    };
  }
  if (type === "time" || type === "hold" || type === "ended") return { session, messages: [], accepted: session.phase === "ready" };
  return unchanged;
}

export function closeSession(session: ReconstructionSession): ReconstructionSession {
  return { ...session, phase: "closed", queue: [] };
}

export function parseTimeDetail(detail: string): { time: number; playing: boolean } {
  const [time, playing] = detail.split("|");
  const parsed = Number(time);
  return { time: Number.isFinite(parsed) ? parsed : 0, playing: playing === "1" };
}

export function commandMessage(token: number, command: ReconstructionCommand): UnityMessage {
  const message = (method: string, value: string): UnityMessage => ({ gameObject: RECONSTRUCTION_BRIDGE_OBJECT, method, value });
  switch (command.kind) {
    case "setHoldPoints":
      return message("SetHoldPoints", `${token}:${command.points.map(formatNumber).join(",")}`);
    case "seek":
      return message("Seek", `${token}:${formatNumber(command.time)}`);
    case "setSpeed":
      return message("SetSpeed", `${token}:${formatNumber(command.speed)}`);
    case "play":
      return message("Play", String(token));
    case "pause":
      return message("Pause", String(token));
    case "restart":
      return message("Restart", String(token));
  }
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value * 1000) / 1000) : "0";
}

const COMMAND_GROUPS: Record<ReconstructionCommand["kind"], readonly string[]> = {
  seek: ["position"],
  restart: ["position", "transport"],
  play: ["transport"],
  pause: ["transport"],
  setSpeed: ["speed"],
  setHoldPoints: ["holds"],
};

/** While loading, only the latest intent per concern is kept: one position, one play/pause, one speed. */
function coalesce(queue: readonly ReconstructionCommand[], command: ReconstructionCommand): ReconstructionCommand[] {
  const groups = COMMAND_GROUPS[command.kind];
  return [...queue.filter((queued) => !COMMAND_GROUPS[queued.kind].some((group) => groups.includes(group))), command];
}
