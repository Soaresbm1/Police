import { describe, expect, it } from "vitest";
import { mapCCTVSequenceToUnityScenario } from "../unity-cctv-bridge";
import { buildCCTVSequence, type CCTVSequenceDescriptor } from "../cctv-sequence";
import { buildCCTVFrameDescriptor } from "../cctv";
import type { Evidence } from "@/lib/game-engine/types/evidence";
import type { TimelineEvent } from "@/lib/game-engine/types/timeline";

/**
 * Phase U3 — req. 22: confirms the EXACT object CASELINE's React component
 * hands to Unity (via `JSON.stringify` + `SendMessage`) is still precisely
 * the whitelisted `UnityCCTVScenario` shape — not merely "doesn't contain
 * some forbidden substring" (already covered by the Phase U2 bridge tests)
 * but an exhaustive key-by-key shape check, so a future field added to
 * `CCTVSequenceDescriptor` can never silently leak into the browser→Unity
 * message just because a spread operator got careless somewhere upstream.
 */
const EXPECTED_SCENARIO_KEYS = ["version", "scene", "camera", "durationSeconds", "actors"].sort();
const EXPECTED_CAMERA_KEYS = ["id", "position", "rotation"].sort();
const EXPECTED_ACTOR_KEYS = ["visualId", "identified", "startTime", "endTime", "startPosition", "endPosition", "walkSpeed"].sort();

const FORBIDDEN_ANYWHERE = [
  "evidenceId",
  "locationId",
  "culpritId",
  "actualMotive",
  "hiddenRole",
  "crimeRelevance",
  "grainSeed",
  "clockStartSecond",
  "fps",
  "quality",
  "visualEvents",
  "appearance",
  "heightBucket",
  "gaitSeed",
];

function makeDescriptor(): CCTVSequenceDescriptor {
  const evidence: Evidence = {
    id: "ev1",
    family: "video",
    type: "camera_footage",
    sourceEventId: "evt1",
    sourceLocationId: "loc1",
    relatedPersonIds: ["p1"],
    relatedLocationIds: ["loc1"],
    timestamp: 1000,
    discoverableAt: 1000,
    discoveryDifficulty: 0.2,
    reliability: "reliable",
    requiresLabAnalysis: null,
    isRedHerring: false,
    status: "discovered",
    description: "ground truth — never sent to Unity",
  };
  const event: TimelineEvent = {
    id: "evt1",
    timestamp: 1000,
    durationMinutes: 1,
    actorId: "p1",
    locationId: "loc1",
    action: "other",
    description: "ground truth, never shown verbatim",
    presentPersonIds: ["p1"],
    counterpartyId: null,
    involvedObject: null,
    observable: true,
    evidenceSourceTags: ["camera"],
    isCrimeEvent: false,
  };
  const frame = buildCCTVFrameDescriptor(evidence);
  return buildCCTVSequence("ev1", frame, event, "parking")!;
}

describe("Runtime bridge message shape — exact whitelist (req. 22)", () => {
  it("the top-level scenario object has exactly the whitelisted keys, no more, no fewer", () => {
    const scenario = mapCCTVSequenceToUnityScenario(makeDescriptor());
    expect(Object.keys(scenario).sort()).toEqual(EXPECTED_SCENARIO_KEYS);
  });

  it("the camera object has exactly the whitelisted keys", () => {
    const scenario = mapCCTVSequenceToUnityScenario(makeDescriptor());
    expect(Object.keys(scenario.camera).sort()).toEqual(EXPECTED_CAMERA_KEYS);
  });

  it("every actor object has exactly the whitelisted keys", () => {
    const scenario = mapCCTVSequenceToUnityScenario(makeDescriptor());
    for (const actor of scenario.actors) {
      expect(Object.keys(actor).sort()).toEqual(EXPECTED_ACTOR_KEYS);
    }
  });

  it("the exact JSON string handed to SendMessage contains none of the forbidden fields", () => {
    const descriptor = makeDescriptor();
    const message = JSON.stringify(mapCCTVSequenceToUnityScenario(descriptor));
    for (const forbidden of FORBIDDEN_ANYWHERE) {
      expect(message).not.toContain(forbidden);
    }
    // The ground-truth description text must never appear in the bridge
    // message either — it exists only on the source Evidence/TimelineEvent,
    // never forwarded by the mapper.
    expect(message).not.toContain("ground truth");
  });

  it("JSON.parse(JSON.stringify(scenario)) round-trips to an equal object (safe to send as a plain string)", () => {
    const scenario = mapCCTVSequenceToUnityScenario(makeDescriptor());
    const roundTripped = JSON.parse(JSON.stringify(scenario));
    expect(roundTripped).toEqual(scenario);
  });
});
