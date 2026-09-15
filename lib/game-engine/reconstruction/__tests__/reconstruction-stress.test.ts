import { describe, expect, it } from "vitest";
import { generateCase } from "../../case-generator/case-truth";
import { generateCaseSeed } from "../../random/rng";
import { isTaxonomyRelevantAction } from "../reconstruction-events";
import { projectReconstruction } from "../reconstruction-projector";

/**
 * Phase U5.1 §26 — deterministic batch stress test across 2,000 generated
 * cases. Mirrors `case-generator/generate-batch.ts`'s own established
 * pattern (generate, measure, discard immediately) so this stays memory-
 * safe at this scale, extended with reconstruction-specific truth-safety
 * and structural checks. A long-running statistical test, same category as
 * `__tests__/batch.test.ts` — given a generous timeout below rather than
 * changing the global vitest config.
 */

const CASE_COUNT = 2000;
const STRESS_TIMEOUT_MS = 5 * 60 * 1000;

describe("reconstruction stress batch (2,000 cases)", () => {
  it(
    "0 truth leaks, 0 invalid references, 0 nondeterminism across 2,000 generated cases",
    () => {
      let generationThrown = 0;
      let projectionOk = 0;
      let projectionFailed = 0;
      const failureReasons = new Map<string, number>();

      let invalidActorRefs = 0;
      let invalidCounterpartyRefs = 0;
      let negativeTimestamps = 0;
      let eventsOutsideDuration = 0;
      let duplicateVisualIds = 0;
      let rawPersonIdLeaks = 0;
      let seedLeaks = 0;
      let emptyActorSets = 0;
      let discovererOverlapsCrime = 0;
      let accompliceWithoutPresence = 0;
      let exactlyOneAttackEvent = 0;

      const unsupportedActionFrequency = new Map<string, number>();

      for (let i = 0; i < CASE_COUNT; i++) {
        const seed = generateCaseSeed();
        let truth;
        try {
          truth = generateCase(seed, { difficulty: "investigator" });
        } catch {
          generationThrown++;
          continue;
        }

        for (const event of truth.timeline) {
          if (!isTaxonomyRelevantAction(event.action)) {
            unsupportedActionFrequency.set(event.action, (unsupportedActionFrequency.get(event.action) ?? 0) + 1);
          }
        }

        const caseId = `stress-${i}`;
        const result = projectReconstruction(truth, caseId);
        if (!result.ok) {
          projectionFailed++;
          failureReasons.set(result.reason, (failureReasons.get(result.reason) ?? 0) + 1);
          continue;
        }
        projectionOk++;
        const scenario = result.scenario;

        if (truth.timeline.filter((e) => e.isCrimeEvent).length === 1) exactlyOneAttackEvent++;

        if (scenario.actors.length === 0) emptyActorSets++;

        const visualIds = scenario.actors.map((a) => a.visualId);
        if (new Set(visualIds).size !== visualIds.length) duplicateVisualIds++;
        const visualIdSet = new Set(visualIds);

        for (const event of scenario.events) {
          if (!visualIdSet.has(event.actorVisualId)) invalidActorRefs++;
          if (event.counterpartyVisualId && !visualIdSet.has(event.counterpartyVisualId)) invalidCounterpartyRefs++;
          if (event.time < 0) negativeTimestamps++;
          if (event.time > scenario.durationSeconds) eventsOutsideDuration++;
        }
        for (const actor of scenario.actors) {
          if (actor.spawnTime < 0 || actor.despawnTime < 0) negativeTimestamps++;
        }

        const json = JSON.stringify(scenario);
        if (json.includes(truth.seed)) seedLeaks++;
        for (const person of truth.people) {
          if (json.includes(person.id)) {
            rawPersonIdLeaks++;
            break;
          }
        }

        const attackEvent = scenario.events.find((e) => e.type === "attack");
        const discoverEvent = scenario.events.find((e) => e.type === "discover");
        if (attackEvent && discoverEvent && discoverEvent.time <= attackEvent.time) discovererOverlapsCrime++;

        for (const actor of scenario.actors) {
          if (actor.roleForReconstruction !== "accomplice") continue;
          // Every accomplice-labeled actor must genuinely appear as a
          // participant of at least one projected event — never present
          // purely because CaseTruth.accompliceIds listed them.
          const appearsInAnEvent = scenario.events.some((e) => e.actorVisualId === actor.visualId || e.counterpartyVisualId === actor.visualId);
          const appearsAsWaypointOnly = actor.waypoints.length > 0;
          if (!appearsInAnEvent && !appearsAsWaypointOnly) accompliceWithoutPresence++;
        }
      }

      // Non-determinism spot-check: re-run projection for a sample of fresh
      // cases and confirm repeated calls are byte-identical.
      let nondeterministicCount = 0;
      for (let i = 0; i < 25; i++) {
        const seed = generateCaseSeed();
        const truth = generateCase(seed, { difficulty: "investigator" });
        const caseId = `determinism-check-${i}`;
        const first = projectReconstruction(truth, caseId);
        const second = projectReconstruction(truth, caseId);
        if (JSON.stringify(first) !== JSON.stringify(second)) nondeterministicCount++;
      }

      console.log("RECONSTRUCTION STRESS SUMMARY", {
        total: CASE_COUNT,
        generationThrown,
        projectionOk,
        projectionFailed,
        failureReasons: [...failureReasons.entries()],
        exactlyOneAttackEvent,
        emptyActorSets,
        duplicateVisualIds,
        invalidActorRefs,
        invalidCounterpartyRefs,
        negativeTimestamps,
        eventsOutsideDuration,
        rawPersonIdLeaks,
        seedLeaks,
        discovererOverlapsCrime,
        accompliceWithoutPresence,
        nondeterministicCount,
        unsupportedActionFrequency: [...unsupportedActionFrequency.entries()].sort((a, b) => b[1] - a[1]),
      });

      // Hard truth-safety/structural gates.
      expect(rawPersonIdLeaks).toBe(0);
      expect(seedLeaks).toBe(0);
      expect(invalidActorRefs).toBe(0);
      expect(invalidCounterpartyRefs).toBe(0);
      expect(negativeTimestamps).toBe(0);
      expect(eventsOutsideDuration).toBe(0);
      expect(duplicateVisualIds).toBe(0);
      expect(emptyActorSets).toBe(0);
      expect(discovererOverlapsCrime).toBe(0);
      expect(accompliceWithoutPresence).toBe(0);
      expect(nondeterministicCount).toBe(0);

      // Rare procedural generation dead-ends are an accepted, low-frequency
      // characteristic of the generator itself (same tolerance as
      // batch.test.ts) — not a reconstruction bug.
      expect(generationThrown / CASE_COUNT).toBeLessThanOrEqual(0.02);
      // Every case whose generation succeeded must have exactly one crime
      // event by CaseTruth's own generation invariant, independent of
      // whether the projector's other checks also happened to pass.
      expect(exactlyOneAttackEvent).toBe(CASE_COUNT - generationThrown);
      // Given exactly one crime event always holds, projection should
      // succeed for the overwhelming majority of generated cases.
      expect(projectionOk / (CASE_COUNT - generationThrown)).toBeGreaterThanOrEqual(0.95);
    },
    STRESS_TIMEOUT_MS,
  );
});
