import { describe, expect, it } from "vitest";
import { mapCCTVSequenceToUnityScenario, UNITY_BRIDGE_SCHEMA_VERSION } from "../unity-cctv-bridge";
import { buildCCTVSequence, type CCTVSequenceDescriptor, type CCTVEnvironmentKind } from "../cctv-sequence";
import { buildCCTVFrameDescriptor } from "../cctv";
import type { Evidence } from "@/lib/game-engine/types/evidence";
import type { TimelineEvent } from "@/lib/game-engine/types/timeline";
import { generateCase } from "@/lib/game-engine/case-generator/case-truth";

function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
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
    description: "test",
    ...overrides,
  };
}

function makeTimelineEvent(overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
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
    ...overrides,
  };
}

function makeDescriptor(overrides: Partial<CCTVSequenceDescriptor> = {}): CCTVSequenceDescriptor {
  const frame = buildCCTVFrameDescriptor(makeEvidence({ reliability: "reliable", discoveryDifficulty: 0.2 }));
  const seq = buildCCTVSequence("ev1", frame, makeTimelineEvent({ durationMinutes: 1 }), "parking")!;
  return { ...seq, ...overrides };
}

describe("mapCCTVSequenceToUnityScenario — determinism (req. 10)", () => {
  it("the same descriptor always yields byte-for-byte identical JSON", () => {
    const descriptor = makeDescriptor();
    const a = mapCCTVSequenceToUnityScenario(descriptor);
    const b = mapCCTVSequenceToUnityScenario(descriptor);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("never mutates the source descriptor", () => {
    const descriptor = makeDescriptor();
    const before = JSON.stringify(descriptor);
    mapCCTVSequenceToUnityScenario(descriptor);
    expect(JSON.stringify(descriptor)).toBe(before);
  });
});

describe("mapCCTVSequenceToUnityScenario — schema version (req. 4)", () => {
  it("stamps the current schema version", () => {
    const scenario = mapCCTVSequenceToUnityScenario(makeDescriptor());
    expect(scenario.version).toBe(UNITY_BRIDGE_SCHEMA_VERSION);
    expect(scenario.version).toBe(1);
  });
});

describe("mapCCTVSequenceToUnityScenario — camera preset strategy (req. 7)", () => {
  it("every environment kind resolves to a deterministic, distinct preset", () => {
    const kinds: CCTVEnvironmentKind[] = ["parking", "corridor", "street", "shop", "generic"];
    const presets = kinds.map((kind) => mapCCTVSequenceToUnityScenario(makeDescriptor({ environment: kind })).camera);
    for (const preset of presets) {
      expect(preset.position).toHaveLength(3);
      expect(preset.rotation).toHaveLength(3);
    }
    // Distinct kinds must not collapse to identical presets.
    const serialized = presets.map((p) => JSON.stringify(p));
    expect(new Set(serialized).size).toBe(kinds.length);
  });

  it("the camera id is forwarded from the descriptor unchanged (already a safe token, e.g. CAM-XXXX)", () => {
    const descriptor = makeDescriptor({ cameraId: "CAM-1D35" });
    const scenario = mapCCTVSequenceToUnityScenario(descriptor);
    expect(scenario.camera.id).toBe("CAM-1D35");
  });
});

describe("mapCCTVSequenceToUnityScenario — environment mapping (req. 6)", () => {
  it("scene mirrors the descriptor's own environment kind", () => {
    for (const kind of ["parking", "corridor", "street", "shop", "generic"] as CCTVEnvironmentKind[]) {
      expect(mapCCTVSequenceToUnityScenario(makeDescriptor({ environment: kind })).scene).toBe(kind);
    }
  });
});

describe("mapCCTVSequenceToUnityScenario — actor mapping (req. 8/9)", () => {
  it("identified mirrors identifiable exactly, visualId is forwarded unchanged", () => {
    const identifiableDescriptor = makeDescriptor({
      actors: [{ visualId: "actor-0", identifiable: true, appearance: { heightBucket: 1, gaitSeed: 5 }, path: { xEntry: 10, xExit: 90, lane: 1 }, visibleFrom: 0, visibleUntil: null }],
    });
    const scenario = mapCCTVSequenceToUnityScenario(identifiableDescriptor);
    expect(scenario.actors[0].identified).toBe(true);
    expect(scenario.actors[0].visualId).toBe("actor-0");

    const anonymousDescriptor = makeDescriptor({
      actors: [{ visualId: "actor-0", identifiable: false, appearance: { heightBucket: 0, gaitSeed: 1 }, path: { xEntry: 10, xExit: 90, lane: 1 }, visibleFrom: 0, visibleUntil: null }],
    });
    expect(mapCCTVSequenceToUnityScenario(anonymousDescriptor).actors[0].identified).toBe(false);
  });

  it("visibleUntil=null maps to endTime === durationSeconds (still present at clip end)", () => {
    const descriptor = makeDescriptor({
      durationSeconds: 24,
      actors: [{ visualId: "actor-0", identifiable: true, appearance: { heightBucket: 1, gaitSeed: 5 }, path: { xEntry: 10, xExit: 90, lane: 1 }, visibleFrom: 0, visibleUntil: null }],
    });
    expect(mapCCTVSequenceToUnityScenario(descriptor).actors[0].endTime).toBe(24);
  });

  it("visibleFrom/visibleUntil map straight to startTime/endTime when both are set", () => {
    const descriptor = makeDescriptor({
      actors: [{ visualId: "actor-0", identifiable: true, appearance: { heightBucket: 1, gaitSeed: 5 }, path: { xEntry: 10, xExit: 90, lane: 1 }, visibleFrom: 2, visibleUntil: 18 }],
    });
    const actor = mapCCTVSequenceToUnityScenario(descriptor).actors[0];
    expect(actor.startTime).toBe(2);
    expect(actor.endTime).toBe(18);
  });

  it("no actor is added or removed by the mapping", () => {
    const descriptor = makeDescriptor({
      actors: [
        { visualId: "actor-0", identifiable: true, appearance: { heightBucket: 1, gaitSeed: 5 }, path: { xEntry: 10, xExit: 90, lane: 1 }, visibleFrom: 0, visibleUntil: null },
        { visualId: "actor-1", identifiable: true, appearance: { heightBucket: 2, gaitSeed: 9 }, path: { xEntry: 90, xExit: 10, lane: 0 }, visibleFrom: 3, visibleUntil: 20 },
      ],
    });
    expect(mapCCTVSequenceToUnityScenario(descriptor).actors).toHaveLength(2);
  });
});

describe("mapCCTVSequenceToUnityScenario — path mapping / direction parity (req. 9/17)", () => {
  it("xExit > xEntry (facing right in 2D) maps to endPosition.x > startPosition.x", () => {
    const descriptor = makeDescriptor({
      actors: [{ visualId: "actor-0", identifiable: true, appearance: { heightBucket: 1, gaitSeed: 5 }, path: { xEntry: 10, xExit: 90, lane: 1 }, visibleFrom: 0, visibleUntil: null }],
    });
    const actor = mapCCTVSequenceToUnityScenario(descriptor).actors[0];
    expect(actor.endPosition[0]).toBeGreaterThan(actor.startPosition[0]);
  });

  it("xExit < xEntry (facing left in 2D) maps to endPosition.x < startPosition.x", () => {
    const descriptor = makeDescriptor({
      actors: [{ visualId: "actor-0", identifiable: true, appearance: { heightBucket: 1, gaitSeed: 5 }, path: { xEntry: 90, xExit: 10, lane: 1 }, visibleFrom: 0, visibleUntil: null }],
    });
    const actor = mapCCTVSequenceToUnityScenario(descriptor).actors[0];
    expect(actor.endPosition[0]).toBeLessThan(actor.startPosition[0]);
  });

  it("startPosition/endPosition/y is always ground level (0)", () => {
    const descriptor = makeDescriptor({
      actors: [{ visualId: "actor-0", identifiable: true, appearance: { heightBucket: 1, gaitSeed: 5 }, path: { xEntry: 10, xExit: 90, lane: 2 }, visibleFrom: 0, visibleUntil: null }],
    });
    const actor = mapCCTVSequenceToUnityScenario(descriptor).actors[0];
    expect(actor.startPosition[1]).toBe(0);
    expect(actor.endPosition[1]).toBe(0);
  });

  it("cosmetic path mapping never feeds back into the source descriptor", () => {
    const descriptor = makeDescriptor();
    const beforePath = JSON.stringify(descriptor.actors[0].path);
    mapCCTVSequenceToUnityScenario(descriptor);
    expect(JSON.stringify(descriptor.actors[0].path)).toBe(beforePath);
  });
});

describe("mapCCTVSequenceToUnityScenario — minimal whitelist / no hidden fields (req. 3/18)", () => {
  it("the exported JSON never contains fields Unity doesn't need", () => {
    const descriptor = makeDescriptor();
    const serialized = JSON.stringify(mapCCTVSequenceToUnityScenario(descriptor));
    for (const forbiddenKey of ["evidenceId", "locationId", "quality", "fps", "clockStartSecond", "grainSeed", "visualEvents", "heightBucket", "gaitSeed", "appearance"]) {
      expect(serialized).not.toContain(forbiddenKey);
    }
  });
});

describe("mapCCTVSequenceToUnityScenario — truth-safety (req. 2/19)", () => {
  it("across a real generated case, no exported scenario leaks culprit/motive/person-id data", () => {
    const truth = generateCase("CASE-UNITY-BRIDGE-SAFETY", { difficulty: "expert" });
    const cameraEvidence = truth.evidence.filter((e) => e.type === "camera_footage");
    for (const ev of cameraEvidence) {
      const frame = buildCCTVFrameDescriptor(ev, truth);
      const sourceEvent = truth.timeline.find((e) => e.id === ev.sourceEventId);
      const location = truth.locations.find((l) => l.id === frame.locationId);
      const descriptor = buildCCTVSequence(ev.id, frame, sourceEvent, location?.type);
      if (!descriptor) continue;
      const scenario = mapCCTVSequenceToUnityScenario(descriptor);
      const serialized = JSON.stringify(scenario).toLowerCase();
      expect(serialized).not.toContain("culprit");
      expect(serialized).not.toContain("motive");
      expect(serialized).not.toContain(truth.culpritId.toLowerCase());
      for (const personId of ev.relatedPersonIds) {
        if (personId.length > 2) expect(serialized).not.toContain(personId.toLowerCase());
      }
    }
  });
});
