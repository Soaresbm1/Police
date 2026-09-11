import { describe, expect, it } from "vitest";
import { buildCCTVFrameDescriptor, describeCCTVObservation, identifiedNamesForCCTV } from "../cctv";
import type { Evidence } from "@/lib/game-engine/types/evidence";
import type { CaseTruth } from "@/lib/game-engine/types/case";
import { generateCase } from "@/lib/game-engine/case-generator/case-truth";

function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: "ev1",
    family: "video",
    type: "camera_footage",
    sourceEventId: "evt1",
    sourceLocationId: "loc1",
    relatedPersonIds: ["p1", "p2"],
    relatedLocationIds: ["loc1"],
    timestamp: 1000,
    discoverableAt: 1000,
    discoveryDifficulty: 0.2,
    reliability: "reliable",
    requiresLabAnalysis: null,
    isRedHerring: false,
    status: "discovered",
    description: "test",
    ...overrides,
  };
}

describe("identifiedNamesForCCTV", () => {
  it("returns no names when the frame is not identifiable, even if visiblePersonIds were somehow non-empty", () => {
    const truth = generateCase("CASE-CCTV-OBS-1", { difficulty: "investigator" });
    const descriptor = buildCCTVFrameDescriptor(makeEvidence({ reliability: "ambiguous", relatedPersonIds: [truth.people[0].id] }), truth);
    expect(descriptor.identifiable).toBe(false);
    expect(identifiedNamesForCCTV(descriptor, truth)).toEqual([]);
  });

  it("returns real player-safe names only when identifiable is true", () => {
    const truth = generateCase("CASE-CCTV-OBS-2", { difficulty: "investigator" });
    const person = truth.people[0];
    const descriptor = buildCCTVFrameDescriptor(makeEvidence({ reliability: "reliable", discoveryDifficulty: 0.2, relatedPersonIds: [person.id] }), truth);
    expect(descriptor.identifiable).toBe(true);
    const names = identifiedNamesForCCTV(descriptor, truth);
    expect(names).toEqual([`${person.firstName} ${person.lastName}`]);
  });

  it("silently drops any person id that doesn't resolve in truth.people, rather than crashing", () => {
    const truth = generateCase("CASE-CCTV-OBS-3", { difficulty: "investigator" });
    const descriptor = buildCCTVFrameDescriptor(makeEvidence({ reliability: "reliable", discoveryDifficulty: 0.2, relatedPersonIds: ["not-a-real-id"] }), truth);
    expect(identifiedNamesForCCTV(descriptor, truth)).toEqual([]);
  });
});

describe("describeCCTVObservation", () => {
  const truth = generateCase("CASE-CCTV-OBS-4", { difficulty: "investigator" }) as CaseTruth;

  it("names the person when the frame is identifiable and a real person is attached", () => {
    const person = truth.people[0];
    const descriptor = buildCCTVFrameDescriptor(makeEvidence({ reliability: "reliable", discoveryDifficulty: 0.2, relatedPersonIds: [person.id] }), truth);
    expect(describeCCTVObservation(descriptor, truth)).toContain(person.firstName);
  });

  it("gives an honest 'present but not identifiable' sentence for a low-quality frame — never a guess", () => {
    const descriptor = buildCCTVFrameDescriptor(makeEvidence({ reliability: "ambiguous" }), truth);
    const text = describeCCTVObservation(descriptor, truth);
    expect(descriptor.identifiable).toBe(false);
    for (const person of truth.people) {
      expect(text).not.toContain(person.firstName);
      expect(text).not.toContain(person.lastName);
    }
    expect(text).toContain("ne permet pas de l'identifier");
  });

  it("is deterministic for the same descriptor", () => {
    const descriptor = buildCCTVFrameDescriptor(makeEvidence({ reliability: "reliable", discoveryDifficulty: 0.2 }), truth);
    expect(describeCCTVObservation(descriptor, truth)).toBe(describeCCTVObservation(descriptor, truth));
  });

  it("across a real generated case, every camera_footage evidence item's observation text respects identifiable", () => {
    const bigTruth = generateCase("CASE-CCTV-OBS-5", { difficulty: "investigator" });
    const cameraEvidence = bigTruth.evidence.filter((ev) => ev.type === "camera_footage" || ev.type === "dashcam_footage");
    for (const ev of cameraEvidence) {
      const descriptor = buildCCTVFrameDescriptor(ev, bigTruth);
      const names = identifiedNamesForCCTV(descriptor, bigTruth);
      if (!descriptor.identifiable) {
        expect(names).toEqual([]);
      }
      const observation = describeCCTVObservation(descriptor, bigTruth);
      expect(observation.length).toBeGreaterThan(0);
    }
  });
});
