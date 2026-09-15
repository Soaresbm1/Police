import { describe, expect, it } from "vitest";
import {
  beginLoad,
  closeSession,
  commandMessage,
  createSession,
  EMBED_MODE_OBJECT,
  enqueue,
  parseTimeDetail,
  RECONSTRUCTION_BRIDGE_OBJECT,
  receiveEvent,
  type ReconstructionSession,
} from "../reconstruction-session";

const JSON_A = '{"caseId":"a"}';

function loaded(token = 7): ReconstructionSession {
  return beginLoad(JSON_A, token).session;
}

describe("reconstruction load handshake", () => {
  it("a load activates reconstruction mode, then loads the scenario under its token", () => {
    const { session, messages } = beginLoad(JSON_A, 3);
    expect(session.phase).toBe("loading");
    expect(messages).toEqual([
      { gameObject: EMBED_MODE_OBJECT, method: "ActivateReconstruction", value: "" },
      { gameObject: RECONSTRUCTION_BRIDGE_OBJECT, method: "LoadScenario", value: `3:${JSON_A}` },
    ]);
  });

  it("a seek issued during loading waits for ready, then goes out under the load's token", () => {
    const queued = enqueue(loaded(), { kind: "seek", time: 560 });
    expect(queued.messages).toEqual([]);

    const ready = receiveEvent(queued.session, "ready", 7, "40440");
    expect(ready.accepted).toBe(true);
    expect(ready.session.phase).toBe("ready");
    expect(ready.messages).toEqual([{ gameObject: RECONSTRUCTION_BRIDGE_OBJECT, method: "Seek", value: "7:560" }]);
    expect(ready.session.queue).toEqual([]);
  });

  it("once ready, commands go out immediately", () => {
    const ready = receiveEvent(loaded(), "ready", 7, "").session;
    expect(enqueue(ready, { kind: "play" }).messages).toEqual([{ gameObject: RECONSTRUCTION_BRIDGE_OBJECT, method: "Play", value: "7" }]);
  });

  it("a newer load discards the older load's queue, and the older ready is ignored", () => {
    const withSeekA = enqueue(loaded(1), { kind: "seek", time: 900 }).session;
    const loadB = beginLoad('{"caseId":"b"}', 2).session;
    expect(loadB.queue).toEqual([]);
    void withSeekA;

    const staleReady = receiveEvent(loadB, "ready", 1, "");
    expect(staleReady.accepted).toBe(false);
    expect(staleReady.messages).toEqual([]);
    expect(staleReady.session.phase).toBe("loading");

    const readyB = receiveEvent(loadB, "ready", 2, "");
    expect(readyB.messages).toEqual([]);
  });

  it("a load failure moves to error and drops everything queued; a later ready changes nothing", () => {
    const queued = enqueue(enqueue(loaded(), { kind: "seek", time: 10 }).session, { kind: "play" }).session;
    const failed = receiveEvent(queued, "load_failed", 7, "invalid_scenario");
    expect(failed.session.phase).toBe("error");
    expect(failed.session.errorCode).toBe("invalid_scenario");
    expect(failed.messages).toEqual([]);

    const lateReady = receiveEvent(failed.session, "ready", 7, "");
    expect(lateReady.accepted).toBe(false);
    expect(lateReady.messages).toEqual([]);
  });

  it("a tokenless load failure can only belong to the load in flight", () => {
    expect(receiveEvent(loaded(), "load_failed", -1, "malformed_command").session.phase).toBe("error");
    const ready = receiveEvent(loaded(), "ready", 7, "").session;
    expect(receiveEvent(ready, "load_failed", -1, "malformed_command").accepted).toBe(false);
  });

  it("closing during loading means the ready that follows is ignored and nothing is sent", () => {
    const closed = closeSession(enqueue(loaded(), { kind: "play" }).session);
    const ready = receiveEvent(closed, "ready", 7, "");
    expect(ready.accepted).toBe(false);
    expect(ready.messages).toEqual([]);
    expect(enqueue(closed, { kind: "seek", time: 1 }).messages).toEqual([]);
  });

  it("playback events only count for the current, ready load", () => {
    const ready = receiveEvent(loaded(), "ready", 7, "").session;
    expect(receiveEvent(ready, "time", 7, "1|1").accepted).toBe(true);
    expect(receiveEvent(ready, "time", 6, "1|1").accepted).toBe(false);
    expect(receiveEvent(loaded(), "time", 7, "1|1").accepted).toBe(false);
  });

  it("while loading, only the latest intent per concern is kept, in order", () => {
    let session = loaded();
    for (const command of [
      { kind: "seek", time: 10 },
      { kind: "play" },
      { kind: "seek", time: 20 },
      { kind: "pause" },
      { kind: "setSpeed", speed: 2 },
      { kind: "setSpeed", speed: 0.5 },
    ] as const) {
      session = enqueue(session, command).session;
    }
    expect(session.queue).toEqual([
      { kind: "seek", time: 20 },
      { kind: "pause" },
      { kind: "setSpeed", speed: 0.5 },
    ]);
  });

  it("restart replaces a pending seek and play", () => {
    let session = enqueue(loaded(), { kind: "seek", time: 5 }).session;
    session = enqueue(session, { kind: "play" }).session;
    session = enqueue(session, { kind: "restart" }).session;
    expect(session.queue).toEqual([{ kind: "restart" }]);
  });

  it("formats command payloads the Unity bridge parses", () => {
    expect(commandMessage(4, { kind: "setHoldPoints", points: [1560, 2000.25] }).value).toBe("4:1560,2000.25");
    expect(commandMessage(4, { kind: "setSpeed", speed: 0.5 }).value).toBe("4:0.5");
    expect(commandMessage(4, { kind: "seek", time: Number.NaN }).value).toBe("4:0");
    expect(commandMessage(4, { kind: "restart" })).toEqual({ gameObject: RECONSTRUCTION_BRIDGE_OBJECT, method: "Restart", value: "4" });
  });

  it("parses time events", () => {
    expect(parseTimeDetail("560.5|1")).toEqual({ time: 560.5, playing: true });
    expect(parseTimeDetail("garbage")).toEqual({ time: 0, playing: false });
  });

  it("starts idle", () => {
    expect(createSession().phase).toBe("idle");
    expect(enqueue(createSession(), { kind: "play" }).messages).toEqual([]);
  });
});
