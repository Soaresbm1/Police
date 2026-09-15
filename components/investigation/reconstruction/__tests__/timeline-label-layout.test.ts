import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildPresentationTimeline } from "@/lib/game-engine/reconstruction/reconstruction-presentation";
import type { ReconstructionScenario } from "@/lib/game-engine/reconstruction/reconstruction-types";
import {
  estimateLabelWidth,
  LABEL_CHAR_WIDTH_PX,
  LABEL_GAP_PX,
  layoutTimelineLabels,
  timelineLabelInputs,
  type TimelineLabelInput,
  type TimelineLabelPlacement,
} from "../timeline-label-layout";

/** The timeline width measured on Preview in a 995 px wide viewport. */
const WIDTH = 887;
const poc = JSON.parse(readFileSync("unity/CaselineVisualPrototype/Assets/StreamingAssets/reconstruction-poc-real.json", "utf-8")) as ReconstructionScenario;

const label = (text: string, percent: number): TimelineLabelInput => ({ key: `${text}@${percent}`, text, percent });

/** Real Case C (CL-2026-7320) marker positions, read from the Preview DOM. */
const caseC = [label("DISCUSSION", 0), label("AGRESSION", 10.7212), label("DÉPART", 13.6452), label("DÉCOUVERTE", 90.2534)];

function expectNoTextOverlap(placements: TimelineLabelPlacement[], width: number) {
  for (const p of placements) {
    if (p.row === null) continue;
    expect(p.leftPx, `${p.text} starts inside the timeline`).toBeGreaterThanOrEqual(0);
    expect(p.leftPx + p.widthPx, `${p.text} ends inside the timeline`).toBeLessThanOrEqual(width);
  }
  for (let i = 0; i < placements.length; i++) {
    for (let j = i + 1; j < placements.length; j++) {
      const [a, b] = [placements[i], placements[j]];
      if (a.row === null || a.row !== b.row) continue;
      const [first, second] = a.leftPx <= b.leftPx ? [a, b] : [b, a];
      expect(second.leftPx - (first.leftPx + first.widthPx), `${first.text} / ${second.text} on row ${a.row}`).toBeGreaterThanOrEqual(LABEL_GAP_PX);
    }
  }
}

describe("layoutTimelineLabels", () => {
  it("A: Case C — AGRESSION (T+11 min) and DÉPART (T+14 min) no longer overlap", () => {
    const placements = layoutTimelineLabels(caseC, WIDTH);
    expectNoTextOverlap(placements, WIDTH);
    expect(placements.map((p) => p.row)).toEqual([0, 1, 0, 0]);

    const narrower = layoutTimelineLabels(caseC, 700);
    expectNoTextOverlap(narrower, 700);
  });

  it("B: three tightly grouped events never share a row while overlapping", () => {
    const placements = layoutTimelineLabels([label("AGRESSION", 40), label("DÉPART", 42), label("DÉCOUVERTE", 44)], WIDTH);
    expectNoTextOverlap(placements, WIDTH);
    expect(placements.map((p) => p.row)).toEqual([0, 1, null]);
  });

  it("C: four tightly grouped events — once both rows are full, the text is left out and the event stays listed", () => {
    const inputs = [label("DISCUSSION", 50), label("AGRESSION", 51), label("DÉPART", 52), label("DÉCOUVERTE", 53)];
    const placements = layoutTimelineLabels(inputs, WIDTH);
    expectNoTextOverlap(placements, WIDTH);
    expect(placements.map((p) => p.row)).toEqual([0, 1, null, null]);
    expect(placements.map((p) => p.key)).toEqual(inputs.map((i) => i.key));
  });

  it("D: collision uses each label's own width, so long labels need more room than short ones", () => {
    expect(estimateLabelWidth("MISE EN SCÈNE")).toBeGreaterThan(estimateLabelWidth("RENCONTRE"));
    expect(estimateLabelWidth("RENCONTRE")).toBeGreaterThan(estimateLabelWidth("APPEL"));
    expect(estimateLabelWidth("DÉPART")).toBe(6 * LABEL_CHAR_WIDTH_PX);

    const placements = layoutTimelineLabels([label("MISE EN SCÈNE", 20), label("RENCONTRE", 27), label("APPEL", 36)], WIDTH);
    expectNoTextOverlap(placements, WIDTH);
    expect(placements.map((p) => p.row)).toEqual([0, 1, 0]);
  });

  it("E: a label at the very start stays inside the timeline", () => {
    const placements = layoutTimelineLabels([label("DISCUSSION", 0), label("RENCONTRE", 1)], WIDTH);
    expectNoTextOverlap(placements, WIDTH);
    expect(placements[0].leftPx).toBe(0);
  });

  it("F: a label at the very end stays inside the timeline", () => {
    const placements = layoutTimelineLabels([label("MISE EN SCÈNE", 99), label("DÉCOUVERTE", 100)], WIDTH);
    expectNoTextOverlap(placements, WIDTH);
    const last = placements[1];
    expect(last.row).not.toBeNull();
    expect(last.leftPx + last.widthPx).toBe(WIDTH);
  });

  it("G: widely spaced events all sit on the first row, centred on their marker", () => {
    const inputs = [label("DISCUSSION", 5), label("AGRESSION", 35), label("DÉPART", 65), label("DÉCOUVERTE", 90)];
    const placements = layoutTimelineLabels(inputs, WIDTH);
    expect(placements.map((p) => p.row)).toEqual([0, 0, 0, 0]);
    placements.forEach((p, i) => expect(p.leftPx).toBe(Math.round((inputs[i].percent / 100) * WIDTH - p.widthPx / 2)));
  });

  it("H: the same markers and width always give the identical layout", () => {
    const first = layoutTimelineLabels(caseC, WIDTH);
    const second = layoutTimelineLabels(caseC, WIDTH);
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("I: markers after a compressed gap are laid out at their bar position without overlap", () => {
    const timeline = buildPresentationTimeline(poc);
    const gap = timeline.segments.find((s) => s.kind === "gap");
    expect(gap).toBeDefined();
    const inputs = timelineLabelInputs(timeline);
    const afterGap = inputs.filter((_, i) => timeline.markers[i].truthTime >= gap!.truthEnd);
    expect(afterGap.length).toBeGreaterThan(0);
    afterGap.forEach((input) => expect(input.percent).toBeGreaterThanOrEqual((gap!.barEnd / timeline.barDuration) * 100));

    for (const width of [WIDTH, 640, 360]) expectNoTextOverlap(layoutTimelineLabels(inputs, width), width);
  });

  it("J: laying out labels never changes which truth time a marker seeks to", () => {
    const timeline = buildPresentationTimeline(poc);
    const before = structuredClone(timeline.markers);
    const placements = layoutTimelineLabels(timelineLabelInputs(timeline), 320);

    expect(timeline.markers).toEqual(before);
    expect(placements).toHaveLength(poc.events.length);
    placements.forEach((p, i) => {
      expect(p.key).toBe(`${timeline.markers[i].type}-${i}`);
      expect(timeline.markers[i].truthTime).toBe(poc.events[i].time);
    });
  });

  it("before the timeline has been measured, no label text is placed", () => {
    expect(layoutTimelineLabels(caseC, 0).every((p) => p.row === null)).toBe(true);
  });
});
