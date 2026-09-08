import { describe, expect, it } from "vitest";
import { buildCCTVFrameDescriptor } from "../cctv";
import type { Evidence, EvidenceReliability } from "@/lib/game-engine/types/evidence";

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

const EXPECTED_IDENTIFIABLE: Record<EvidenceReliability, boolean> = {
  reliable: true,
  partial: true,
  ambiguous: false,
  contaminated: false,
  falsified: false,
};

describe("buildCCTVFrameDescriptor", () => {
  it("maps every reliability tier to the correct identifiable flag", () => {
    for (const [reliability, expected] of Object.entries(EXPECTED_IDENTIFIABLE) as [EvidenceReliability, boolean][]) {
      const descriptor = buildCCTVFrameDescriptor(makeEvidence({ reliability, discoveryDifficulty: 0.2 }));
      expect(descriptor.identifiable).toBe(expected);
    }
  });

  it("never exposes visiblePersonIds when not identifiable", () => {
    const descriptor = buildCCTVFrameDescriptor(makeEvidence({ reliability: "ambiguous" }));
    expect(descriptor.identifiable).toBe(false);
    expect(descriptor.visiblePersonIds).toEqual([]);
  });

  it("exposes visiblePersonIds when identifiable", () => {
    const descriptor = buildCCTVFrameDescriptor(makeEvidence({ reliability: "reliable", discoveryDifficulty: 0.2 }));
    expect(descriptor.visiblePersonIds).toEqual(["p1", "p2"]);
  });

  it("degrades an otherwise-clear shot when discovery difficulty is high", () => {
    const descriptor = buildCCTVFrameDescriptor(makeEvidence({ reliability: "reliable", discoveryDifficulty: 0.9 }));
    expect(descriptor.visibilityQuality).toBe("partial");
    expect(descriptor.identifiable).toBe(true);
  });

  it("is deterministic for the same evidence", () => {
    const ev = makeEvidence();
    expect(buildCCTVFrameDescriptor(ev)).toEqual(buildCCTVFrameDescriptor(ev));
  });
});
