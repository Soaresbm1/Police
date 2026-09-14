import { describe, expect, it } from "vitest";
import { mapCCTVSequenceToUnityScenario } from "../unity-cctv-bridge";
import { buildCCTVSequence } from "../cctv-sequence";
import { buildCCTVFrameDescriptor } from "../cctv";
import { generateCase } from "@/lib/game-engine/case-generator/case-truth";

/**
 * Phase U2 — cross-renderer parity (req. 17/18). CASELINE's own Canvas
 * renderer and the Unity prototype must agree SEMANTICALLY on every real
 * CCTV sequence: same duration, same actor visibility window, same
 * direction, same entry/exit side, same identifiable/anonymous state, same
 * environment kind. They never need to be pixel-identical (different
 * engines, different visual treatment) — only semantically identical, so a
 * QA reviewer looking at both never sees a contradiction.
 */
const PARITY_CASE_COUNT = 200;
const DIFFICULTIES = ["recruit", "investigator", "inspector", "expert"] as const;

describe("Unity CCTV bridge — cross-renderer parity", () => {
  it("agrees with the source descriptor on every semantic fact, across 200 real generated cases", () => {
    let comparedScenarios = 0;

    for (let i = 0; i < PARITY_CASE_COUNT; i++) {
      const difficulty = DIFFICULTIES[i % DIFFICULTIES.length];
      const truth = generateCase(`CASE-UNITY-BRIDGE-PARITY-${i}`, { difficulty });
      const cameraEvidence = truth.evidence.filter((e) => e.type === "camera_footage");

      for (const ev of cameraEvidence) {
        const frame = buildCCTVFrameDescriptor(ev, truth);
        const sourceEvent = ev.sourceEventId ? truth.timeline.find((e) => e.id === ev.sourceEventId) : undefined;
        const location = truth.locations.find((l) => l.id === frame.locationId);
        const descriptor = buildCCTVSequence(ev.id, frame, sourceEvent, location?.type);
        if (!descriptor) continue;

        const scenario = mapCCTVSequenceToUnityScenario(descriptor);
        comparedScenarios++;

        // Duration preserved.
        expect(scenario.durationSeconds).toBe(descriptor.durationSeconds);

        // Environment preserved.
        expect(scenario.scene).toBe(descriptor.environment);

        // Actor count preserved — no actor added or removed.
        expect(scenario.actors).toHaveLength(descriptor.actors.length);

        for (let a = 0; a < descriptor.actors.length; a++) {
          const sourceActor = descriptor.actors[a];
          const mappedActor = scenario.actors[a];

          // Identifiable preserved.
          expect(mappedActor.identified).toBe(sourceActor.identifiable);

          // Visibility interval preserved (visibleUntil=null means "still
          // present at clip end" on both sides).
          expect(mappedActor.startTime).toBe(sourceActor.visibleFrom);
          expect(mappedActor.endTime).toBe(sourceActor.visibleUntil ?? descriptor.durationSeconds);

          // Direction / entry-exit side preserved: the sign of horizontal
          // travel must match on both renderers.
          const source2dDirection = Math.sign(sourceActor.path.xExit - sourceActor.path.xEntry);
          const unity3dDirection = Math.sign(mappedActor.endPosition[0] - mappedActor.startPosition[0]);
          expect(unity3dDirection).toBe(source2dDirection);
        }
      }
    }

    expect(comparedScenarios).toBeGreaterThan(0);
  }, 60_000);
});
