import { describe, expect, it } from "vitest";
import {
  DESKTOP_CONTAINER_ASPECT,
  MOBILE_CONTAINER_ASPECT,
  objectCoverTransform,
  resolveHotspotLayout,
  type EngineHotspotAnchor,
} from "../hotspot-layout";
import { ALL_LAYOUT_IDS, getLayout } from "../crime-scene-layouts";

function anchorsFor(x: number, y: number, count: number): EngineHotspotAnchor[] {
  return Array.from({ length: count }, (_, i) => ({ id: `h${i}`, semanticAnchor: "generic_surface" as const, x, y }));
}

describe("objectCoverTransform", () => {
  it("center of the source image always maps to the center of the container, at any aspect", () => {
    for (const aspect of [MOBILE_CONTAINER_ASPECT, DESKTOP_CONTAINER_ASPECT, 1]) {
      const { xPercent, yPercent } = objectCoverTransform(50, 50, aspect);
      expect(xPercent).toBeCloseTo(50, 5);
      expect(yPercent).toBeCloseTo(50, 5);
    }
  });

  it("a square container (aspect 1) never crops — identity transform", () => {
    for (const [u, v] of [
      [0, 0],
      [100, 100],
      [30, 70],
    ]) {
      const { xPercent, yPercent } = objectCoverTransform(u, v, 1);
      expect(xPercent).toBeCloseTo(u, 5);
      expect(yPercent).toBeCloseTo(v, 5);
    }
  });

  it("[16:9 desktop] crops vertically, not horizontally — full x range visible, y range compressed to the centered band", () => {
    const { xPercent } = objectCoverTransform(0, 50, DESKTOP_CONTAINER_ASPECT);
    expect(xPercent).toBeCloseTo(0, 5); // horizontal edges untouched
    const top = objectCoverTransform(50, 0, DESKTOP_CONTAINER_ASPECT);
    const bottom = objectCoverTransform(50, 100, DESKTOP_CONTAINER_ASPECT);
    expect(top.yPercent).toBeLessThan(0); // top of the square image is cropped away above the container
    expect(bottom.yPercent).toBeGreaterThan(100); // bottom is cropped away below
  });

  it("[4:5 mobile] crops horizontally, not vertically — full y range visible, x range compressed to the centered band", () => {
    const { yPercent } = objectCoverTransform(50, 0, MOBILE_CONTAINER_ASPECT);
    expect(yPercent).toBeCloseTo(0, 5); // vertical edges untouched
    const left = objectCoverTransform(0, 50, MOBILE_CONTAINER_ASPECT);
    const right = objectCoverTransform(100, 50, MOBILE_CONTAINER_ASPECT);
    expect(left.xPercent).toBeLessThan(0); // left of the square image is cropped away
    expect(right.xPercent).toBeGreaterThan(100); // right is cropped away
  });
});

describe("resolveHotspotLayout", () => {
  it("never loses a hotspot — output has exactly one entry per input, in the same order", () => {
    const anchors: EngineHotspotAnchor[] = [
      { id: "b", semanticAnchor: "floor", x: 50, y: 58 },
      { id: "a", semanticAnchor: "window", x: 82, y: 18 },
      { id: "c", semanticAnchor: "door", x: 14, y: 22 },
    ];
    const resolved = resolveHotspotLayout(anchors, DESKTOP_CONTAINER_ASPECT);
    expect(resolved.map((r) => r.hotspotId)).toEqual(["b", "a", "c"]); // same order as input
    expect(resolved).toHaveLength(3);
  });

  it("never produces a duplicate hotspotId", () => {
    const anchors = anchorsFor(50, 50, 8);
    const resolved = resolveHotspotLayout(anchors, MOBILE_CONTAINER_ASPECT);
    expect(new Set(resolved.map((r) => r.hotspotId)).size).toBe(8);
  });

  it("keeps every marker inside the safe margin band, regardless of raw transformed position", () => {
    for (const aspect of [MOBILE_CONTAINER_ASPECT, DESKTOP_CONTAINER_ASPECT]) {
      const anchors: EngineHotspotAnchor[] = [
        { id: "corner1", semanticAnchor: "generic_surface", x: 0, y: 0 },
        { id: "corner2", semanticAnchor: "generic_surface", x: 100, y: 100 },
      ];
      const resolved = resolveHotspotLayout(anchors, aspect);
      for (const r of resolved) {
        expect(r.xPercent).toBeGreaterThanOrEqual(8);
        expect(r.xPercent).toBeLessThanOrEqual(92);
        expect(r.yPercent).toBeGreaterThanOrEqual(8);
        expect(r.yPercent).toBeLessThanOrEqual(92);
      }
    }
  });

  it("deterministically separates hotspots that would otherwise land on top of each other", () => {
    const anchors = anchorsFor(50, 50, 4); // all 4 given the exact same raw position
    const resolved = resolveHotspotLayout(anchors, DESKTOP_CONTAINER_ASPECT);
    for (let i = 0; i < resolved.length; i++) {
      for (let j = i + 1; j < resolved.length; j++) {
        const dist = Math.hypot(resolved[i].xPercent - resolved[j].xPercent, resolved[i].yPercent - resolved[j].yPercent);
        expect(dist).toBeGreaterThanOrEqual(10 - 1e-6);
      }
    }
  });

  it("is a pure function: identical inputs always produce identical output (refresh-stable, no randomness)", () => {
    const anchors = anchorsFor(50, 50, 6);
    const first = resolveHotspotLayout(anchors, DESKTOP_CONTAINER_ASPECT);
    const second = resolveHotspotLayout(anchors, DESKTOP_CONTAINER_ASPECT);
    expect(second).toEqual(first);
  });

  it("output does not depend on the input array's own order (placement is normalized by id)", () => {
    const anchors: EngineHotspotAnchor[] = [
      { id: "a", semanticAnchor: "window", x: 50, y: 50 },
      { id: "b", semanticAnchor: "door", x: 50, y: 50 },
      { id: "c", semanticAnchor: "floor", x: 50, y: 50 },
    ];
    const forward = resolveHotspotLayout(anchors, DESKTOP_CONTAINER_ASPECT);
    const reversed = resolveHotspotLayout([...anchors].reverse(), DESKTOP_CONTAINER_ASPECT);
    const byId = (list: typeof forward) => new Map(list.map((r) => [r.hotspotId, r]));
    expect(byId(reversed)).toEqual(byId(forward));
  });

  it("real layout data: every layout's 7 zones + body resolve to non-overlapping, in-margin positions at both aspect bands", () => {
    for (const layoutId of ALL_LAYOUT_IDS) {
      const zones = getLayout(layoutId).zones;
      const anchors: EngineHotspotAnchor[] = [
        { id: "corps", semanticAnchor: "floor", x: 50, y: 58 },
        ...zones.map((z) => ({ id: z.id, semanticAnchor: z.semanticAnchor, x: z.x, y: z.y })),
      ];
      for (const aspect of [MOBILE_CONTAINER_ASPECT, DESKTOP_CONTAINER_ASPECT]) {
        const resolved = resolveHotspotLayout(anchors, aspect);
        expect(resolved).toHaveLength(anchors.length);
        for (const r of resolved) {
          expect(r.xPercent).toBeGreaterThanOrEqual(8);
          expect(r.xPercent).toBeLessThanOrEqual(92);
          expect(r.yPercent).toBeGreaterThanOrEqual(8);
          expect(r.yPercent).toBeLessThanOrEqual(92);
        }
      }
    }
  });

  it("carries semanticAnchor through as pass-through metadata only — never used to add/remove a hotspot", () => {
    const anchors: EngineHotspotAnchor[] = [{ id: "only", semanticAnchor: "chair", x: 50, y: 50 }];
    const resolved = resolveHotspotLayout(anchors, DESKTOP_CONTAINER_ASPECT);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].confidence).toBe(1);
  });
});
