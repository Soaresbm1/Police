import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  barToTruth,
  buildPresentationTimeline,
  currentMarker,
  EVENT_LABELS_FR,
  formatElapsed,
  gapAtHold,
  IDLE_SKIP_THRESHOLD_SECONDS,
  mergedActivitySpans,
  POST_ACTIVITY_DWELL_SECONDS,
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
  const gaps = timeline.segments.filter((s) => s.kind === "gap");
  const plays = timeline.segments.filter((s) => s.kind === "play");
  const activity = mergedActivitySpans(poc);

  it("plays every stretch where something happens and skips the ones where nothing does", () => {
    expect(gaps.length).toBeGreaterThan(0);
    for (const gap of gaps) {
      expect(gap.truthEnd - gap.truthStart).toBeGreaterThanOrEqual(IDLE_SKIP_THRESHOLD_SECONDS);
      for (const span of activity) {
        expect(span.start >= gap.truthEnd || span.end <= gap.truthStart, `activity ${span.start}-${span.end} inside gap ${gap.truthStart}-${gap.truthEnd}`).toBe(true);
      }
    }
    for (const span of activity) {
      expect(plays.some((p) => p.truthStart <= span.start && p.truthEnd >= span.end)).toBe(true);
    }
    expect(timeline.holdPoints).toEqual(gaps.map((g) => g.truthStart));
  });

  it("holds for the dwell after the last thing that moved, then skips", () => {
    for (const gap of gaps) {
      const lastActivityEnd = activity.filter((s) => s.end <= gap.truthStart).reduce((latest, s) => Math.max(latest, s.end), 0);
      expect(gap.truthStart).toBeCloseTo(Math.min(lastActivityEnd + POST_ACTIVITY_DWELL_SECONDS, timeline.truthDuration), 6);
    }
  });

  it("turns hours of truth into a viewing measured in seconds", () => {
    const watched = plays.reduce((sum, p) => sum + (p.truthEnd - p.truthStart), 0);
    expect(timeline.truthDuration).toBeGreaterThan(10 * 3600);
    expect(watched).toBeLessThan(90);
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

  it("places markers in order along a bar where each gap is visible but short", () => {
    const positions = timeline.markers.map((m) => m.barPosition);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    for (const gap of gaps) {
      expect(gap.barEnd - gap.barStart).toBeGreaterThan(0);
      expect(gap.barEnd - gap.barStart).toBeLessThan(0.15 * timeline.barDuration);
    }
  });

  it("maps truth to the bar and back through play segments exactly", () => {
    for (const play of plays) {
      for (const t of [play.truthStart, (play.truthStart + play.truthEnd) / 2, play.truthEnd]) {
        expect(barToTruth(timeline, truthToBar(timeline, t))).toBeCloseTo(t, 6);
      }
    }
  });

  it("never lands inside a gap: bar positions and seeks within one resolve to its far side", () => {
    for (const gap of gaps) {
      const middle = (gap.truthStart + gap.truthEnd) / 2;
      expect(barToTruth(timeline, (gap.barStart + gap.barEnd) / 2)).toBe(gap.truthEnd);
      expect(snapOutOfGap(timeline, middle)).toBe(gap.truthEnd);
      expect(truthToBar(timeline, middle)).toBe(gap.barStart);
    }
    expect(snapOutOfGap(timeline, 0)).toBe(0);
    expect(snapOutOfGap(timeline, 540)).toBe(540);
  });

  it("finds the gap for each hold and reports the current event", () => {
    for (const gap of gaps) expect(gapAtHold(timeline, gap.truthStart)?.truthEnd).toBe(gap.truthEnd);
    expect(gapAtHold(timeline, 540)).toBeNull();
    expect(currentMarker(timeline, 600)?.label).toBe("AGRESSION");
    expect(currentMarker(timeline, 39850)?.label).toBe("DÉCOUVERTE");
  });

  it("is deterministic", () => {
    expect(JSON.stringify(buildPresentationTimeline(poc))).toBe(JSON.stringify(timeline));
  });
});

describe("buildPresentationTimeline — rules", () => {
  it("a scenario where beats follow each other closely is one play segment with no holds", () => {
    const timeline = buildPresentationTimeline(
      scenario({
        durationSeconds: 40,
        events: [
          { time: 0, type: "talk", actorVisualId: "c", counterpartyVisualId: "v", locationSlot: "interaction" },
          { time: 10, type: "attack", actorVisualId: "c", counterpartyVisualId: "v", locationSlot: "crime_point" },
          { time: 20, type: "leave_scene", actorVisualId: "c", locationSlot: "exit" },
        ],
      }),
    );
    expect(timeline.segments).toHaveLength(1);
    expect(timeline.holdPoints).toEqual([]);
  });

  it("a stretch where nothing changes is skipped once it is longer than the threshold", () => {
    const timeline = buildPresentationTimeline(
      scenario({
        durationSeconds: 1000,
        events: [
          { time: 0, type: "talk", actorVisualId: "c", counterpartyVisualId: "v", locationSlot: "interaction" },
          { time: 900, type: "discover", actorVisualId: "w", locationSlot: "crime_point" },
        ],
      }),
    );
    expect(timeline.segments.map((s) => [s.kind, s.truthStart, s.truthEnd])).toEqual([
      ["play", 0, 5],
      ["gap", 5, 900],
      ["play", 900, 905],
      ["gap", 905, 1000],
    ]);
  });

  it("never skips over someone still walking", () => {
    const timeline = buildPresentationTimeline(
      scenario({
        durationSeconds: 1200,
        actors: [
          {
            visualId: "w",
            roleForReconstruction: "unnamed",
            genericAppearance: "casual_neutral",
            spawnTime: 0,
            despawnTime: 1200,
            waypoints: [
              { time: 0, slot: "entrance" },
              { time: 1000, slot: "crime_point" },
            ],
          },
        ],
        events: [{ time: 0, type: "talk", actorVisualId: "w", locationSlot: "entrance" }],
      }),
    );
    // The leg is walked over its last 8 s, arriving at 1000: that window must play, only the wait before it skips.
    for (const gap of timeline.segments.filter((s) => s.kind === "gap")) {
      expect(gap.truthStart <= 992 || gap.truthStart >= 1000).toBe(true);
      expect(gap.truthEnd <= 992 || gap.truthEnd >= 1000).toBe(true);
    }
    expect(timeline.segments.some((s) => s.kind === "play" && s.truthStart <= 992 && s.truthEnd >= 1000)).toBe(true);
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
