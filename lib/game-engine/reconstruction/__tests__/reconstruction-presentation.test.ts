import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  barToTruth,
  buildPresentationTimeline,
  currentMarker,
  EVENT_LABELS_FR,
  formatElapsed,
  gapAtHold,
  snapOutOfGap,
  truthToBar,
} from "../reconstruction-presentation";
import type { ReconstructionScenario } from "../reconstruction-types";

const poc = JSON.parse(readFileSync("unity/CaselineVisualPrototype/Assets/StreamingAssets/reconstruction-poc-real.json", "utf-8")) as ReconstructionScenario;

function scenario(overrides: Partial<ReconstructionScenario>): ReconstructionScenario {
  return { version: 1, caseId: "presentation-test", environment: "generic", durationSeconds: 100, actors: [], events: [], ...overrides };
}

describe("buildPresentationTimeline — real POC", () => {
  const timeline = buildPresentationTimeline(poc);

  it("plays the scene, skips the dead period once the culprit has gone, then plays the discovery", () => {
    expect(timeline.segments.map((s) => [s.kind, s.truthStart, s.truthEnd])).toEqual([
      ["play", 0, 1560],
      ["gap", 1560, 39840],
      ["play", 39840, 40440],
    ]);
    expect(timeline.holdPoints).toEqual([1560]);
  });

  it("keeps event truth times untouched and labels only from event types", () => {
    expect(timeline.markers.map((m) => [m.label, m.truthTime])).toEqual([
      ["DISCUSSION", 0],
      ["AGRESSION", 540],
      ["DÉPART", 1140],
      ["DÉCOUVERTE", 39840],
    ]);
    expect(poc.events.map((e) => e.time)).toEqual([0, 540, 1140, 39840]);
  });

  it("places markers in order along a bar where the gap is visible but short", () => {
    const positions = timeline.markers.map((m) => m.barPosition);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    const gap = timeline.segments[1];
    expect(gap.barEnd - gap.barStart).toBeGreaterThan(0);
    expect(gap.barEnd - gap.barStart).toBeLessThan(0.15 * timeline.barDuration);
  });

  it("maps truth to the bar and back through play segments exactly", () => {
    for (const t of [0, 300, 540, 1559, 39840, 40000, 40440]) {
      expect(barToTruth(timeline, truthToBar(timeline, t))).toBeCloseTo(t, 6);
    }
  });

  it("never lands inside the gap: bar positions and seeks within it resolve to the discovery side", () => {
    const gap = timeline.segments[1];
    expect(barToTruth(timeline, (gap.barStart + gap.barEnd) / 2)).toBe(39840);
    expect(snapOutOfGap(timeline, 20000)).toBe(39840);
    expect(snapOutOfGap(timeline, 1000)).toBe(1000);
    expect(snapOutOfGap(timeline, 39840)).toBe(39840);
    expect(truthToBar(timeline, 20000)).toBe(gap.barStart);
  });

  it("finds the gap for a hold and reports the current event", () => {
    expect(gapAtHold(timeline, 1560)?.truthEnd).toBe(39840);
    expect(gapAtHold(timeline, 540)).toBeNull();
    expect(currentMarker(timeline, 600)?.label).toBe("AGRESSION");
    expect(currentMarker(timeline, 39850)?.label).toBe("DÉCOUVERTE");
  });

  it("is deterministic", () => {
    expect(JSON.stringify(buildPresentationTimeline(poc))).toBe(JSON.stringify(timeline));
  });
});

describe("buildPresentationTimeline — rules", () => {
  it("a scenario without a long gap is one play segment with no holds", () => {
    const timeline = buildPresentationTimeline(
      scenario({
        durationSeconds: 900,
        events: [
          { time: 0, type: "talk", actorVisualId: "c", counterpartyVisualId: "v", locationSlot: "interaction" },
          { time: 600, type: "attack", actorVisualId: "c", counterpartyVisualId: "v", locationSlot: "crime_point" },
        ],
      }),
    );
    expect(timeline.segments).toHaveLength(1);
    expect(timeline.holdPoints).toEqual([]);
    expect(timeline.barDuration).toBe(900);
  });

  it("never skips over someone still moving: an actor present for the whole gap turns it back into playback", () => {
    const timeline = buildPresentationTimeline(
      scenario({
        durationSeconds: 5000,
        actors: [{ visualId: "w", roleForReconstruction: "unnamed", genericAppearance: "casual_neutral", spawnTime: 0, despawnTime: 5000, waypoints: [{ time: 0, slot: "exit" }] }],
        events: [
          { time: 0, type: "leave_scene", actorVisualId: "w", locationSlot: "exit" },
          { time: 4000, type: "discover", actorVisualId: "w", locationSlot: "crime_point" },
        ],
      }),
    );
    expect(timeline.holdPoints).toEqual([]);
    expect(timeline.segments.every((s) => s.kind === "play")).toBe(true);
  });

  it("formats a relative clock readably", () => {
    expect(formatElapsed(45)).toBe("T+45 s");
    expect(formatElapsed(560)).toBe("T+9 min 20 s");
    expect(formatElapsed(39840)).toBe("T+11 h 04 min");
    expect(formatElapsed(-3)).toBe("T+0 s");
  });

  it("labels every event type in French", () => {
    for (const label of Object.values(EVENT_LABELS_FR)) expect(label).toMatch(/^[A-ZÀ-Ý ]+$/);
  });
});
