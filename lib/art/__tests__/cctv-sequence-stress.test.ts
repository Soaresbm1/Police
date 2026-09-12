import { describe, expect, it } from "vitest";
import { buildCCTVSequence, type CCTVVisualEventType } from "../cctv-sequence";
import { buildCCTVFrameDescriptor } from "../cctv";
import { generateCase } from "@/lib/game-engine/case-generator/case-truth";

/**
 * Phase 3 stress test (req. 41). Not a correctness assertion suite by
 * itself (the targeted tests in cctv-sequence.test.ts already cover
 * specific invariants) — this generates a large, varied sample of real
 * cases and reports honest aggregate statistics, per the brief's explicit
 * instruction not to optimize metrics by inventing information: if only a
 * fraction of CCTV evidence can truthfully animate, the numbers below say
 * so.
 */
const CASE_COUNT = 2000;
const ALLOWED_VISUAL_EVENT_TYPES: ReadonlySet<CCTVVisualEventType> = new Set(["enter_frame", "exit_frame", "motion_detected"]);
const DIFFICULTIES = ["recruit", "investigator", "inspector", "expert"] as const;

describe("CCTV sequence — 2,000-case stress statistics (req. 41)", () => {
  it("generates aggregate statistics across 2000 cases and asserts zero safety violations", () => {
    let itemsGenerated = 0;
    let animatable = 0;
    let staticFallback = 0;
    let identifiableCount = 0;
    let anonymousCount = 0;
    let multiActorCount = 0;
    let invalidIntervals = 0;
    let identityLeaks = 0;
    let hiddenIdLeaks = 0;
    let unsupportedActions = 0;
    let deterministicMismatches = 0;
    let thrownErrors = 0;
    const durations: number[] = [];

    const FORBIDDEN_WORDS = ["attack", "exchange_object", "hide_object", "steal", "fight", "dispose_evidence"];

    for (let i = 0; i < CASE_COUNT; i++) {
      const difficulty = DIFFICULTIES[i % DIFFICULTIES.length];
      const seed = `CASE-CCTV-STRESS-${i}`;
      let truth;
      try {
        truth = generateCase(seed, { difficulty });
      } catch {
        thrownErrors++;
        continue;
      }

      const cameraEvidence = truth.evidence.filter((e) => e.type === "camera_footage" || e.type === "dashcam_footage");
      for (const ev of cameraEvidence) {
        itemsGenerated++;
        let seq;
        try {
          const frame = buildCCTVFrameDescriptor(ev, truth);
          const sourceEvent = ev.sourceEventId ? truth.timeline.find((e) => e.id === ev.sourceEventId) : undefined;
          seq = buildCCTVSequence(ev.id, frame, sourceEvent);

          if (!seq) {
            staticFallback++;
            continue;
          }
          animatable++;

          if (frame.identifiable) identifiableCount++;
          else anonymousCount++;
          if (seq.actors.length > 1) multiActorCount++;
          durations.push(seq.durationSeconds);

          if (seq.durationSeconds < 10 || seq.durationSeconds > 40) invalidIntervals++;
          for (const actor of seq.actors) {
            if (actor.visibleUntil !== null && actor.visibleFrom > actor.visibleUntil) invalidIntervals++;
            if (actor.visibleFrom < 0 || actor.visibleFrom > seq.durationSeconds) invalidIntervals++;
            if (actor.visibleUntil !== null && (actor.visibleUntil < 0 || actor.visibleUntil > seq.durationSeconds)) invalidIntervals++;
            if (!frame.identifiable && actor.identifiable) identityLeaks++;
          }
          for (const ve of seq.visualEvents) {
            if (!ALLOWED_VISUAL_EVENT_TYPES.has(ve.type)) unsupportedActions++;
          }

          const serialized = JSON.stringify(seq).toLowerCase();
          for (const word of FORBIDDEN_WORDS) {
            if (serialized.includes(word)) unsupportedActions++;
          }
          if (serialized.includes("culprit") || serialized.includes("motive")) hiddenIdLeaks++;
          for (const personId of ev.relatedPersonIds) {
            if (personId.length > 2 && JSON.stringify(seq).includes(personId)) hiddenIdLeaks++;
          }

          // Determinism check: rebuilding from the same inputs must be identical.
          const frame2 = buildCCTVFrameDescriptor(ev, truth);
          const sourceEvent2 = ev.sourceEventId ? truth.timeline.find((e) => e.id === ev.sourceEventId) : undefined;
          const seq2 = buildCCTVSequence(ev.id, frame2, sourceEvent2);
          if (JSON.stringify(seq) !== JSON.stringify(seq2)) deterministicMismatches++;
        } catch {
          thrownErrors++;
        }
      }
    }

    const pct = (n: number) => (itemsGenerated > 0 ? ((n / itemsGenerated) * 100).toFixed(1) : "0.0");
    const report = {
      casesGenerated: CASE_COUNT,
      itemsGenerated,
      animatablePct: pct(animatable),
      staticFallbackPct: pct(staticFallback),
      identifiablePct: pct(identifiableCount),
      anonymousPct: pct(anonymousCount),
      multiActorPct: pct(multiActorCount),
      avgDurationSeconds: durations.length > 0 ? (durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(1) : "n/a",
      minDurationSeconds: durations.length > 0 ? Math.min(...durations) : "n/a",
      maxDurationSeconds: durations.length > 0 ? Math.max(...durations) : "n/a",
      invalidIntervals,
      identityLeaks,
      hiddenIdLeaks,
      unsupportedActions,
      deterministicMismatches,
      thrownErrors,
    };
    console.log("[CCTV Phase 3 stress report]", JSON.stringify(report, null, 2));

    expect(invalidIntervals).toBe(0);
    expect(identityLeaks).toBe(0);
    expect(hiddenIdLeaks).toBe(0);
    expect(unsupportedActions).toBe(0);
    expect(deterministicMismatches).toBe(0);
    expect(thrownErrors).toBe(0);
    expect(itemsGenerated).toBeGreaterThan(0);
  }, 120_000);
});
