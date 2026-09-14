import { describe, expect, it } from "vitest";
import { mapCCTVSequenceToUnityScenario, UNITY_BRIDGE_SCHEMA_VERSION } from "../unity-cctv-bridge";
import { buildCCTVSequence } from "../cctv-sequence";
import { buildCCTVFrameDescriptor } from "../cctv";
import { generateCase } from "@/lib/game-engine/case-generator/case-truth";

/**
 * Phase U2 — 2,000-case truth-safety scan of the CASELINE → Unity bridge
 * (req. 19). Reports honest aggregate statistics rather than tuning for a
 * target number; the assertions at the end enforce the hard zero-tolerance
 * requirements (leaks, deterministic mismatches, invalid scenarios).
 */
const CASE_COUNT = 2000;
const DIFFICULTIES = ["recruit", "investigator", "inspector", "expert"] as const;

describe("Unity CCTV bridge — 2,000-case leak scan (req. 19)", () => {
  it("scans 2000 generated cases' exported scenarios for leaks and mismatches", () => {
    let exportedScenarios = 0;
    let rawPersonIdLeaks = 0;
    let culpritIdLeaks = 0;
    let actualMotiveLeaks = 0;
    let hiddenRoleLeaks = 0;
    let crimeRelevanceLeaks = 0;
    let unknownSchemaVersions = 0;
    let invalidScenarios = 0;
    let deterministicMismatches = 0;
    let thrownErrors = 0;

    for (let i = 0; i < CASE_COUNT; i++) {
      const difficulty = DIFFICULTIES[i % DIFFICULTIES.length];
      const seed = `CASE-UNITY-BRIDGE-STRESS-${i}`;
      let truth;
      try {
        truth = generateCase(seed, { difficulty });
      } catch {
        thrownErrors++;
        continue;
      }

      const culpritIdLower = truth.culpritId.toLowerCase();
      const cameraEvidence = truth.evidence.filter((e) => e.type === "camera_footage");

      for (const ev of cameraEvidence) {
        try {
          const frame = buildCCTVFrameDescriptor(ev, truth);
          const sourceEvent = ev.sourceEventId ? truth.timeline.find((e) => e.id === ev.sourceEventId) : undefined;
          const location = truth.locations.find((l) => l.id === frame.locationId);
          const descriptor = buildCCTVSequence(ev.id, frame, sourceEvent, location?.type);
          if (!descriptor) continue;

          const scenario = mapCCTVSequenceToUnityScenario(descriptor);
          exportedScenarios++;

          if (scenario.version !== UNITY_BRIDGE_SCHEMA_VERSION) unknownSchemaVersions++;
          if (!scenario.camera || !Array.isArray(scenario.actors)) invalidScenarios++;

          const serialized = JSON.stringify(scenario).toLowerCase();
          if (serialized.includes("culprit")) culpritIdLeaks++;
          if (serialized.includes(culpritIdLower)) culpritIdLeaks++;
          if (serialized.includes("motive")) actualMotiveLeaks++;
          if (serialized.includes("hiddenrole")) hiddenRoleLeaks++;
          if (serialized.includes("crimerelevance")) crimeRelevanceLeaks++;
          for (const personId of ev.relatedPersonIds) {
            if (personId.length > 2 && serialized.includes(personId.toLowerCase())) rawPersonIdLeaks++;
          }

          // Determinism: rebuilding from the same descriptor must be identical.
          const scenario2 = mapCCTVSequenceToUnityScenario(descriptor);
          if (JSON.stringify(scenario) !== JSON.stringify(scenario2)) deterministicMismatches++;
        } catch {
          thrownErrors++;
        }
      }
    }

    const report = {
      casesGenerated: CASE_COUNT,
      exportedScenarios,
      rawPersonIdLeaks,
      culpritIdLeaks,
      actualMotiveLeaks,
      hiddenRoleLeaks,
      crimeRelevanceLeaks,
      unknownSchemaVersions,
      invalidScenarios,
      deterministicMismatches,
      thrownErrors,
    };
    console.log("[Unity CCTV bridge stress report]", JSON.stringify(report, null, 2));

    expect(rawPersonIdLeaks).toBe(0);
    expect(culpritIdLeaks).toBe(0);
    expect(actualMotiveLeaks).toBe(0);
    expect(hiddenRoleLeaks).toBe(0);
    expect(crimeRelevanceLeaks).toBe(0);
    expect(unknownSchemaVersions).toBe(0);
    expect(invalidScenarios).toBe(0);
    expect(deterministicMismatches).toBe(0);
    expect(thrownErrors).toBe(0);
    expect(exportedScenarios).toBeGreaterThan(0);
  }, 120_000);
});
