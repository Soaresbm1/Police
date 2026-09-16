import { describe, expect, it } from "vitest";
import { generateCase } from "../../case-generator/case-truth";
import { generateCaseSeed } from "../../random/rng";
import type { CrimeMethod } from "../../types/case";
import { buildPresentationTimeline, GAP_TRANSITION_MS, mergedActivitySpans } from "../reconstruction-presentation";
import { projectReconstruction } from "../reconstruction-projector";

/**
 * Phase U5.4 §8/§35 — pacing and crime-method diagnostic across 2,000 generated cases. Measures how much of the
 * presentation a player would actually watch, how much of it is visually idle, and which safe visual actions the
 * projector really emits. Same generate-measure-discard pattern as reconstruction-stress.test.ts.
 */

const CASE_COUNT = 2000;
const DIAGNOSTIC_TIMEOUT_MS = 8 * 60 * 1000;

function percentiles(values: number[]): Record<string, number> {
  if (values.length === 0) return { p0: 0, p50: 0, p90: 0, p99: 0, p100: 0, mean: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]);
  return {
    p0: Math.round(sorted[0]),
    p50: at(0.5),
    p90: at(0.9),
    p99: at(0.99),
    p100: Math.round(sorted[sorted.length - 1]),
    mean: Math.round(sorted.reduce((sum, v) => sum + v, 0) / sorted.length),
  };
}

/**
 * The safe visual actions Unity's ReconstructionActorTimeline.AnimStateForSafeVisualAction implements, each with
 * its own beat. Mirrored here so a new CrimeMethod can never reach players as an action the build cannot show:
 * anything unknown falls back to the neutral interaction on the Unity side, never to a blow.
 */
const UNITY_IMPLEMENTED_ACTIONS: Record<string, string> = {
  attack_strike: "AttackStrike",
  attack_strangle: "AttackStrangle",
  attack_stab: "AttackStab",
  attack_firearm: "AttackFirearm",
  attack_push: "AttackPush",
  attack_administer_substance: "NeutralInteraction",
  manipulate_scene: "ManipulateScene",
};

describe("reconstruction pacing + crime-method diagnostic (2,000 cases)", () => {
  it(
    "measures presentation pacing, idle time and safe visual action coverage",
    () => {
      const methodCases = new Map<CrimeMethod, number>();
      const visualActions = new Map<string, number>();
      const stageActions = new Map<string, number>();

      let projected = 0;
      let generationThrown = 0;
      let projectionFailed = 0;
      let scenariosWithGap = 0;
      let eventsInsideGap = 0;
      let movementInterruptedByGap = 0;
      let bodyMissingAcrossGap = 0;
      let culpritPresentAtDiscovery = 0;
      let accompliceCases = 0;
      let stagedCases = 0;

      const skipsPerScenario: number[] = [];
      const truthGapDurations: number[] = [];
      const idleBeforeSkip: number[] = [];
      const idleWatchedTotal: number[] = [];
      const presentationSeconds: number[] = [];
      const truthDurations: number[] = [];

      for (let i = 0; i < CASE_COUNT; i++) {
        let truth;
        try {
          truth = generateCase(generateCaseSeed(), { difficulty: "investigator" });
        } catch {
          generationThrown++;
          continue;
        }

        const result = projectReconstruction(truth, `pacing-${i}`);
        if (!result.ok) {
          projectionFailed++;
          continue;
        }
        projected++;
        const scenario = result.scenario;
        methodCases.set(truth.methodType, (methodCases.get(truth.methodType) ?? 0) + 1);
        for (const event of scenario.events) {
          if (event.type === "attack") visualActions.set(event.safeVisualAction ?? "(none)", (visualActions.get(event.safeVisualAction ?? "(none)") ?? 0) + 1);
          if (event.type === "stage_scene") stageActions.set(event.safeVisualAction ?? "(none)", (stageActions.get(event.safeVisualAction ?? "(none)") ?? 0) + 1);
        }
        if (scenario.actors.some((a) => a.roleForReconstruction === "accomplice")) accompliceCases++;
        if (scenario.events.some((e) => e.type === "stage_scene")) stagedCases++;

        const timeline = buildPresentationTimeline(scenario);
        const spans = mergedActivitySpans(scenario);
        const gaps = timeline.segments.filter((s) => s.kind === "gap");
        const plays = timeline.segments.filter((s) => s.kind === "play");

        skipsPerScenario.push(gaps.length);
        if (gaps.length > 0) scenariosWithGap++;
        truthDurations.push(scenario.durationSeconds);

        // What the player sits through: every play segment at 1x, plus each transition.
        presentationSeconds.push(plays.reduce((sum, s) => sum + (s.truthEnd - s.truthStart), 0) + (gaps.length * GAP_TRANSITION_MS) / 1000);

        // Idle actually watched: play-segment time with no visual activity under it.
        let idleWatched = 0;
        for (const play of plays) {
          const busy = spans.reduce((sum, span) => sum + Math.max(0, Math.min(span.end, play.truthEnd) - Math.max(span.start, play.truthStart)), 0);
          idleWatched += play.truthEnd - play.truthStart - busy;
        }
        idleWatchedTotal.push(idleWatched);

        for (const gap of gaps) {
          truthGapDurations.push(gap.truthEnd - gap.truthStart);
          const lastActivityEnd = spans.filter((s) => s.end <= gap.truthStart).reduce((latest, s) => Math.max(latest, s.end), 0);
          idleBeforeSkip.push(gap.truthStart - lastActivityEnd);
          if (scenario.events.some((e) => e.time > gap.truthStart && e.time < gap.truthEnd)) eventsInsideGap++;
          if (spans.some((s) => s.start < gap.truthStart && s.end > gap.truthStart)) movementInterruptedByGap++;
        }

        const discover = scenario.events.find((e) => e.type === "discover");
        const victim = scenario.actors.find((a) => a.roleForReconstruction === "victim");
        const culprit = scenario.actors.find((a) => a.roleForReconstruction === "culprit");
        if (discover && victim && victim.despawnTime < discover.time) bodyMissingAcrossGap++;
        if (discover && culprit && culprit.visualId !== discover.actorVisualId && culprit.despawnTime >= discover.time) culpritPresentAtDiscovery++;
      }

      console.log("U5.4 PACING DIAGNOSTIC", {
        total: CASE_COUNT,
        generationThrown,
        projectionFailed,
        projected,
        methodCases: [...methodCases.entries()].sort((a, b) => b[1] - a[1]),
        attackVisualActions: [...visualActions.entries()].sort((a, b) => b[1] - a[1]),
        stageVisualActions: [...stageActions.entries()],
        accompliceCases,
        stagedCases,
        scenariosWithGap,
        skipsPerScenario: percentiles(skipsPerScenario),
        truthDurationSeconds: percentiles(truthDurations),
        truthGapSeconds: percentiles(truthGapDurations),
        idleBeforeSkipSeconds: percentiles(idleBeforeSkip),
        idleWatchedSeconds: percentiles(idleWatchedTotal),
        presentationSecondsAt1x: percentiles(presentationSeconds),
        eventsInsideGap,
        movementInterruptedByGap,
        bodyMissingAcrossGap,
        culpritPresentAtDiscovery,
      });

      // Every action a real case can produce must be one Unity actually implements.
      for (const action of [...visualActions.keys(), ...stageActions.keys()]) {
        expect(UNITY_IMPLEMENTED_ACTIONS[action], `${action} has no Unity beat`).toBeDefined();
      }
      // Every method must have been exercised, so "supported" is never claimed from an untested path.
      expect([...methodCases.keys()].sort()).toEqual(["blunt_force", "fall_push", "firearm", "poisoning", "stabbing", "staged_overdose", "strangulation"]);

      // Invariants that must hold before and after any pacing change.
      expect(eventsInsideGap).toBe(0);
      expect(movementInterruptedByGap).toBe(0);
      expect(bodyMissingAcrossGap).toBe(0);
      expect(culpritPresentAtDiscovery).toBe(0);
      expect(projected).toBeGreaterThan(CASE_COUNT * 0.9);
    },
    DIAGNOSTIC_TIMEOUT_MS,
  );
});
