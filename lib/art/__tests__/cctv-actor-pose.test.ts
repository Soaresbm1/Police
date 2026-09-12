import { describe, expect, it } from "vitest";
import { computeActorPose, solveTwoBoneIK, CCTV_CANVAS_WIDTH } from "../cctv-actor-pose";
import type { CCTVActor } from "../cctv-sequence";

function makeActor(overrides: Partial<CCTVActor> = {}): CCTVActor {
  return {
    visualId: "actor-0",
    identifiable: true,
    appearance: { heightBucket: 1, gaitSeed: 42 },
    path: { xEntry: 10, xExit: 90, lane: 1 },
    visibleFrom: 0,
    visibleUntil: null,
    ...overrides,
  };
}

describe("computeActorPose — determinism (req. 18: same timestamp = same pose)", () => {
  it("the same actor/t/duration always yields an identical pose", () => {
    const actor = makeActor();
    const a = computeActorPose(actor, 12, 24);
    const b = computeActorPose(actor, 12, 24);
    expect(a).toEqual(b);
  });

  it("never mutates the actor or any nested object it was given", () => {
    const actor = makeActor();
    const frozen = JSON.parse(JSON.stringify(actor));
    computeActorPose(actor, 5, 24);
    computeActorPose(actor, 15, 24);
    expect(actor).toEqual(frozen);
  });
});

describe("computeActorPose — gait seed (req. 18: same cosmetic seed = same walk cycle)", () => {
  it("two actors with the same gaitSeed produce the same walkPhase at the same t", () => {
    const a = makeActor({ appearance: { heightBucket: 1, gaitSeed: 7 } });
    const b = makeActor({ appearance: { heightBucket: 1, gaitSeed: 7 } });
    expect(computeActorPose(a, 10, 24)!.walkPhase).toBe(computeActorPose(b, 10, 24)!.walkPhase);
  });

  it("a different gaitSeed changes the cadence (walkPhase differs at the same t, same path)", () => {
    const a = makeActor({ appearance: { heightBucket: 1, gaitSeed: 7 } });
    const b = makeActor({ appearance: { heightBucket: 1, gaitSeed: 63 } });
    const poseA = computeActorPose(a, 10, 24)!;
    const poseB = computeActorPose(b, 10, 24)!;
    expect(poseA.walkPhase).not.toBe(poseB.walkPhase);
  });
});

describe("computeActorPose — direction (req. 18: direction mirrors correctly)", () => {
  it("faces right when xExit >= xEntry", () => {
    const actor = makeActor({ path: { xEntry: 10, xExit: 90, lane: 1 } });
    expect(computeActorPose(actor, 5, 24)!.facingRight).toBe(true);
  });

  it("faces left when xExit < xEntry", () => {
    const actor = makeActor({ path: { xEntry: 90, xExit: 10, lane: 1 } });
    expect(computeActorPose(actor, 5, 24)!.facingRight).toBe(false);
  });
});

describe("computeActorPose — idle/pause (req. 14/18: pause produces idle state)", () => {
  it("a stationary path (xEntry === xExit) always reports idle with zero walkPhase", () => {
    const actor = makeActor({ path: { xEntry: 50, xExit: 50, lane: 1 } });
    for (const t of [0, 5, 12, 24]) {
      const pose = computeActorPose(actor, t, 24)!;
      expect(pose.idle).toBe(true);
      expect(pose.walkPhase).toBe(0);
      expect(pose.bob).toBe(0);
    }
  });

  it("a moving path is not idle away from its very start", () => {
    const actor = makeActor({ path: { xEntry: 10, xExit: 90, lane: 1 } });
    const pose = computeActorPose(actor, 12, 24)!;
    expect(pose.idle).toBe(false);
  });
});

describe("computeActorPose — identity safety (req. 11/18: anonymous actor carries no identity information)", () => {
  it("the pose object's only identity-adjacent field is the boolean identifiable, mirroring the actor", () => {
    const anonymous = makeActor({ identifiable: false });
    const pose = computeActorPose(anonymous, 5, 24)!;
    expect(pose.identifiable).toBe(false);
    const keys = Object.keys(pose).sort();
    expect(keys).toEqual(["bob", "facingRight", "figureHeightPx", "idle", "identifiable", "scale", "walkPhase", "x"].sort());
    // No field is or contains a string — nothing to leak a name/id into.
    for (const value of Object.values(pose)) {
      expect(typeof value).not.toBe("string");
    }
  });
});

describe("computeActorPose — path bounds (req. 18: actor stays inside expected path bounds)", () => {
  it("x is always within [min(xEntryPx, xExitPx), max(xEntryPx, xExitPx)] for every t in the visible window", () => {
    const actor = makeActor({ path: { xEntry: 20, xExit: 70, lane: 2 }, visibleFrom: 2, visibleUntil: 18 });
    const xEntryPx = (20 / 100) * CCTV_CANVAS_WIDTH;
    const xExitPx = (70 / 100) * CCTV_CANVAS_WIDTH;
    const lo = Math.min(xEntryPx, xExitPx);
    const hi = Math.max(xEntryPx, xExitPx);
    for (let t = 2; t <= 18; t += 1) {
      const pose = computeActorPose(actor, t, 24)!;
      expect(pose.x).toBeGreaterThanOrEqual(lo - 0.001);
      expect(pose.x).toBeLessThanOrEqual(hi + 0.001);
    }
  });

  it("returns null outside [visibleFrom, visibleUntil] — the renderer draws nothing there", () => {
    const actor = makeActor({ visibleFrom: 5, visibleUntil: 15 });
    expect(computeActorPose(actor, 4, 24)).toBeNull();
    expect(computeActorPose(actor, 16, 24)).toBeNull();
    expect(computeActorPose(actor, 5, 24)).not.toBeNull();
    expect(computeActorPose(actor, 15, 24)).not.toBeNull();
  });
});

describe("solveTwoBoneIK — geometry", () => {
  it("the joint sits exactly upperLength from the origin", () => {
    const { jointX, jointY } = solveTwoBoneIK(0, 0, 10, 20, 12, 12);
    expect(Math.hypot(jointX, jointY)).toBeCloseTo(12, 5);
  });

  it("the end point is clamped to at most upperLength + lowerLength from the origin", () => {
    const { endX, endY } = solveTwoBoneIK(0, 0, 1000, 1000, 12, 12);
    expect(Math.hypot(endX, endY)).toBeLessThanOrEqual(24);
  });

  it("is a pure function of its inputs", () => {
    const a = solveTwoBoneIK(5, 100, 20, 100, 14, 13);
    const b = solveTwoBoneIK(5, 100, 20, 100, 14, 13);
    expect(a).toEqual(b);
  });
});
