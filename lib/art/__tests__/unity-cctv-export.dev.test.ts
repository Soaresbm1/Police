import { describe, expect, it } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { mapCCTVSequenceToUnityScenario, type UnityCCTVScenario } from "../unity-cctv-bridge";
import { buildCCTVSequence } from "../cctv-sequence";
import { buildCCTVFrameDescriptor } from "../cctv";
import { generateCase } from "@/lib/game-engine/case-generator/case-truth";

/**
 * Phase U2 — TEMPORARY developer-only export mechanism (req. 11/12). Not a
 * production API, not wired into any route: this just searches real
 * generated CASELINE cases for a handful of representative real CCTV
 * scenarios and writes them, through the same safe bridge every other test
 * in this file exercises, straight into the Unity prototype's
 * StreamingAssets folder for manual visual inspection.
 *
 * Guarded behind `UNITY_EXPORT=1` so it never writes files during a normal
 * `npm test` run (or CI) — the assertions below still run every time and
 * confirm the search/mapping logic itself is sound; only the file-write
 * step is skipped by default. To actually (re)generate the sample files:
 *
 *   $env:UNITY_EXPORT="1"; npx vitest run lib/art/__tests__/unity-cctv-export.dev.test.ts
 *
 * Every exported file is a byte-for-byte deterministic function of its
 * seed string (via `generateCase`) — there is no session/user data in any
 * of these, so they are safe-by-construction even if committed later
 * (this phase itself does not commit anything).
 */
const DIFFICULTIES = ["recruit", "investigator", "inspector", "expert"] as const;
const OUTPUT_DIR = path.resolve(__dirname, "../../../unity/CaselineVisualPrototype/Assets/StreamingAssets");

interface ExportTarget {
  fileName: string;
  identifiable: boolean;
  environment: "parking" | "corridor" | "street" | "shop";
}

const TARGETS: ExportTarget[] = [
  { fileName: "real-identifiable-parking.json", identifiable: true, environment: "parking" },
  { fileName: "real-anonymous-corridor.json", identifiable: false, environment: "corridor" },
  { fileName: "real-identifiable-shop.json", identifiable: true, environment: "shop" },
];

function findScenarioFor(target: ExportTarget, maxSeeds: number): UnityCCTVScenario | null {
  for (let i = 0; i < maxSeeds; i++) {
    const difficulty = DIFFICULTIES[i % DIFFICULTIES.length];
    const truth = generateCase(`CASE-UNITY-EXPORT-SEARCH-${i}`, { difficulty });
    const cameraEvidence = truth.evidence.filter((e) => e.type === "camera_footage");

    for (const ev of cameraEvidence) {
      const frame = buildCCTVFrameDescriptor(ev, truth);
      if (frame.identifiable !== target.identifiable) continue;

      const sourceEvent = ev.sourceEventId ? truth.timeline.find((e) => e.id === ev.sourceEventId) : undefined;
      const location = truth.locations.find((l) => l.id === frame.locationId);
      const descriptor = buildCCTVSequence(ev.id, frame, sourceEvent, location?.type);
      if (!descriptor || descriptor.environment !== target.environment) continue;

      return mapCCTVSequenceToUnityScenario(descriptor);
    }
  }
  return null;
}

describe("Unity CCTV export (temporary dev-only helper, Phase U2 req. 11/12)", () => {
  it("finds and maps at least one real scenario per required profile (identifiable, anonymous, 2+ environments)", () => {
    const found: Record<string, UnityCCTVScenario | null> = {};
    for (const target of TARGETS) {
      found[target.fileName] = findScenarioFor(target, 1500);
    }

    for (const target of TARGETS) {
      expect(found[target.fileName], `no real case found for ${target.fileName} within the search budget`).not.toBeNull();
    }

    if (process.env.UNITY_EXPORT === "1") {
      mkdirSync(OUTPUT_DIR, { recursive: true });
      for (const target of TARGETS) {
        const scenario = found[target.fileName]!;
        const outPath = path.join(OUTPUT_DIR, target.fileName);
        writeFileSync(outPath, JSON.stringify(scenario, null, 2), "utf-8");
        console.log(`[Unity CCTV export] wrote ${outPath}`);
      }
    }
  }, 60_000);
});
