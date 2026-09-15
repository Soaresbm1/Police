import { writeFileSync } from "node:fs";
import { projectReconstruction } from "../reconstruction-projector";
import { findPocCase } from "./poc-case-finder";

/**
 * Phase U5.2 — TEST/DEV ONLY, one-shot export tool. Not imported by any
 * production/app code, not picked up by vitest (does not end in
 * `.test.ts`). Run manually via `npx tsx` (or ts-node) to (re)generate the
 * single real POC fixture JSON committed under the Unity project's
 * StreamingAssets, exactly the same "generateCase() -> projector -> JSON
 * file" pipeline a later phase's real integration will use, minus any
 * player-facing wiring.
 *
 * Deliberately uses a stable, non-seed-revealing caseId
 * ("poc-fixture-u5-2") rather than the case's real seed — see
 * reconstruction-projector.ts's own seed/caseId safety check.
 */
const match = findPocCase();
if (!match) {
  throw new Error("no POC case found matching the U5.0 §25 criteria");
}

const result = projectReconstruction(match.truth, "poc-fixture-u5-2");
if (!result.ok) {
  throw new Error(`projection failed: ${result.reason}`);
}

const outPath = process.argv[2] ?? "unity/CaselineVisualPrototype/Assets/StreamingAssets/reconstruction-poc-real.json";
writeFileSync(outPath, JSON.stringify(result.scenario, null, 2) + "\n", "utf-8");

console.log(
  JSON.stringify(
    {
      outPath,
      environment: result.scenario.environment,
      durationSeconds: result.scenario.durationSeconds,
      actorCount: result.scenario.actors.length,
      eventCount: result.scenario.events.length,
      methodSafeAction: result.scenario.events.find((e) => e.type === "attack")?.safeVisualAction,
      archetype: match.truth.archetype,
      methodType: match.truth.methodType,
    },
    null,
    2,
  ),
);
