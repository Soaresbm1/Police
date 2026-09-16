import { writeFileSync } from "node:fs";
import { generateCase } from "../../case-generator/case-truth";
import type { CrimeMethod } from "../../types/case";
import { projectReconstruction } from "../reconstruction-projector";

/**
 * Phase U5.4 §25/§26 — TEST/DEV ONLY, one-shot export tool (not a vitest file, never imported by app code).
 * Writes one REAL PROJECTED scenario per CrimeMethod into the Unity project's StreamingAssets so each method's
 * visual beat can be inspected in the standalone prototype scene's switcher. Every fixture comes from a real
 * generateCase() -> projector run over a deterministic seed sequence: nothing here is hand-written, so what is
 * inspected is exactly what a player would get.
 *
 * Run with: npx tsx lib/game-engine/reconstruction/__tests__/export-method-fixtures.ts
 */

const METHODS: CrimeMethod[] = ["blunt_force", "stabbing", "strangulation", "firearm", "fall_push", "poisoning", "staged_overdose"];
const OUT_DIR = "unity/CaselineVisualPrototype/Assets/StreamingAssets";
const MAX_SEEDS = 4000;

function seedFor(i: number): string {
  return `CASE-${(i + 500000).toString(36).toUpperCase().padStart(6, "0").slice(-6)}`;
}

const remaining = new Set(METHODS);
const found: Array<Record<string, unknown>> = [];

for (let i = 0; i < MAX_SEEDS && remaining.size > 0; i++) {
  let truth;
  try {
    truth = generateCase(seedFor(i), { difficulty: "investigator" });
  } catch {
    continue;
  }
  if (!remaining.has(truth.methodType)) continue;

  const caseId = `qa-real-${truth.methodType.replace(/_/g, "-")}`;
  const result = projectReconstruction(truth, caseId);
  if (!result.ok) continue;

  const file = `${OUT_DIR}/reconstruction-method-${truth.methodType.replace(/_/g, "-")}.json`;
  writeFileSync(file, JSON.stringify(result.scenario, null, 2) + "\n", "utf-8");
  remaining.delete(truth.methodType);
  found.push({
    method: truth.methodType,
    file,
    seedIndex: i,
    environment: result.scenario.environment,
    durationSeconds: result.scenario.durationSeconds,
    actors: result.scenario.actors.map((a) => a.roleForReconstruction),
    events: result.scenario.events.map((e) => [e.type, e.time, e.safeVisualAction ?? ""]),
    staged: result.scenario.events.some((e) => e.type === "stage_scene"),
  });
}

console.log(JSON.stringify({ exported: found, missing: [...remaining] }, null, 2));
