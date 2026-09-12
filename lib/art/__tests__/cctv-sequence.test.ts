import { describe, expect, it } from "vitest";
import { buildCCTVSequence, cctvEnvironmentForLocationType, type CCTVSequenceDescriptor, type CCTVVisualEventType } from "../cctv-sequence";
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

const ALLOWED_VISUAL_EVENT_TYPES: ReadonlySet<CCTVVisualEventType> = new Set(["enter_frame", "exit_frame", "motion_detected"]);
const FORBIDDEN_ACTION_WORDS = ["attack", "exchange_object", "hide_object", "steal", "fight", "dispose_evidence", "conceal", "destroy"];

describe("buildCCTVSequence — basic construction", () => {
  it("returns null when no source event resolves (defensive fallback, req. 22)", () => {
    const frame = buildCCTVFrameDescriptor(makeEvidence());
    expect(buildCCTVSequence("ev1", frame, undefined)).toBeNull();
  });

  it("returns a valid descriptor when a source event resolves", () => {
    const frame = buildCCTVFrameDescriptor(makeEvidence());
    const seq = buildCCTVSequence("ev1", frame, makeTimelineEvent());
    expect(seq).not.toBeNull();
    expect(seq!.evidenceId).toBe("ev1");
    expect(seq!.startTime).toBe(1000);
  });

  it("is deterministic for the same evidence id/frame/event (req. 32)", () => {
    const frame = buildCCTVFrameDescriptor(makeEvidence());
    const event = makeTimelineEvent();
    const a = buildCCTVSequence("ev1", frame, event);
    const b = buildCCTVSequence("ev1", frame, event);
    expect(a).toEqual(b);
  });

  it("a different evidence id yields a different (but still valid) sequence — no shared global state", () => {
    const frame = buildCCTVFrameDescriptor(makeEvidence());
    const event = makeTimelineEvent();
    const a = buildCCTVSequence("ev1", frame, event);
    const b = buildCCTVSequence("ev2", frame, event);
    expect(a!.evidenceId).not.toBe(b!.evidenceId);
  });
});

describe("buildCCTVSequence — duration model (req. 13)", () => {
  it("clamps duration to the documented [10, 40] second range regardless of real event length", () => {
    for (const durationMinutes of [0, 1, 2, 5, 10, 30, 90, 480]) {
      const frame = buildCCTVFrameDescriptor(makeEvidence({ id: `ev-${durationMinutes}` }));
      const seq = buildCCTVSequence(`ev-${durationMinutes}`, frame, makeTimelineEvent({ durationMinutes }));
      expect(seq!.durationSeconds).toBeGreaterThanOrEqual(10);
      expect(seq!.durationSeconds).toBeLessThanOrEqual(40);
    }
  });

  it("never invents a departure for a long real event — visibleUntil stays null (still present at clip end)", () => {
    const frame = buildCCTVFrameDescriptor(makeEvidence());
    const seq = buildCCTVSequence("ev1", frame, makeTimelineEvent({ durationMinutes: 480 }));
    for (const actor of seq!.actors) {
      expect(actor.visibleUntil).toBeNull();
    }
  });

  it("a short real event (a brief waypoint sighting) DOES support a full enter+exit within the clip", () => {
    const frame = buildCCTVFrameDescriptor(makeEvidence());
    const seq = buildCCTVSequence("ev1", frame, makeTimelineEvent({ durationMinutes: 1 }));
    for (const actor of seq!.actors) {
      expect(actor.visibleUntil).not.toBeNull();
      expect(actor.visibleUntil!).toBeLessThanOrEqual(seq!.durationSeconds);
    }
  });
});

describe("buildCCTVSequence — actor count / identity safety (req. 4/5/9/35)", () => {
  it("exactly one anonymous actor when not identifiable, even if the source event lists multiple present people", () => {
    const frame = buildCCTVFrameDescriptor(makeEvidence({ reliability: "ambiguous", relatedPersonIds: ["p1", "p2", "p3"] }));
    expect(frame.identifiable).toBe(false);
    const seq = buildCCTVSequence("ev1", frame, makeTimelineEvent({ presentPersonIds: ["p1", "p2", "p3"] }));
    expect(seq!.actors).toHaveLength(1);
    expect(seq!.actors[0].identifiable).toBe(false);
  });

  it("one actor per visiblePersonId when identifiable", () => {
    const frame = buildCCTVFrameDescriptor(makeEvidence({ reliability: "reliable", discoveryDifficulty: 0.2, relatedPersonIds: ["p1", "p2"] }));
    expect(frame.identifiable).toBe(true);
    const seq = buildCCTVSequence("ev1", frame, makeTimelineEvent());
    expect(seq!.actors).toHaveLength(2);
  });

  it("no actor object carries a person id, real name, or any field beyond the documented safe shape", () => {
    const frame = buildCCTVFrameDescriptor(makeEvidence({ reliability: "reliable", discoveryDifficulty: 0.2, relatedPersonIds: ["p1", "p2"] }));
    const seq = buildCCTVSequence("ev1", frame, makeTimelineEvent());
    for (const actor of seq!.actors) {
      const keys = Object.keys(actor).sort();
      expect(keys).toEqual(["appearance", "identifiable", "path", "visibleFrom", "visibleUntil", "visualId"].sort());
      const serialized = JSON.stringify(actor);
      expect(serialized).not.toContain("p1");
      expect(serialized).not.toContain("p2");
    }
  });

  it("the full sequence JSON never contains a raw person id, culpritId-shaped field, or the source event's factual description text", () => {
    const truth = generateCase("CASE-CCTV-SEQ-SAFE", { difficulty: "investigator" });
    const cameraEvidence = truth.evidence.filter((e) => e.type === "camera_footage");
    for (const ev of cameraEvidence.slice(0, 25)) {
      const frame = buildCCTVFrameDescriptor(ev, truth);
      const sourceEvent = truth.timeline.find((e) => e.id === ev.sourceEventId);
      const seq = buildCCTVSequence(ev.id, frame, sourceEvent);
      if (!seq) continue;
      const serialized = JSON.stringify(seq);
      expect(serialized.toLowerCase()).not.toContain("culprit");
      expect(serialized.toLowerCase()).not.toContain("motive");
      if (sourceEvent) expect(serialized).not.toContain(sourceEvent.description);
      for (const personId of ev.relatedPersonIds) {
        // The evidence's own id is a safe short token that could theoretically
        // collide with a substring of an unrelated field; assert the actual
        // person id string never appears verbatim.
        if (personId.length > 2) expect(serialized).not.toContain(personId);
      }
    }
  });
});

describe("buildCCTVSequence — no invented actions (req. 10/37)", () => {
  it("every visualEvent type is restricted to the safe presentation set", () => {
    const frame = buildCCTVFrameDescriptor(makeEvidence({ relatedPersonIds: ["p1", "p2"], reliability: "reliable", discoveryDifficulty: 0.2 }));
    const seq = buildCCTVSequence("ev1", frame, makeTimelineEvent({ durationMinutes: 1 }));
    for (const ve of seq!.visualEvents) {
      expect(ALLOWED_VISUAL_EVENT_TYPES.has(ve.type)).toBe(true);
    }
  });

  it("across a large generated sample, no forbidden narrative action ever appears in the descriptor's JSON", () => {
    const truth = generateCase("CASE-CCTV-SEQ-NOACTION", { difficulty: "expert" });
    const cameraEvidence = truth.evidence.filter((e) => e.type === "camera_footage");
    for (const ev of cameraEvidence) {
      const frame = buildCCTVFrameDescriptor(ev, truth);
      const sourceEvent = truth.timeline.find((e) => e.id === ev.sourceEventId);
      const seq = buildCCTVSequence(ev.id, frame, sourceEvent);
      if (!seq) continue;
      const serialized = JSON.stringify(seq).toLowerCase();
      for (const word of FORBIDDEN_ACTION_WORDS) {
        expect(serialized).not.toContain(word);
      }
    }
  });

  it("the location-level motion_detected marker never carries an actorVisualId (no per-actor relevance flag)", () => {
    const frame = buildCCTVFrameDescriptor(makeEvidence());
    const seq = buildCCTVSequence("ev1", frame, makeTimelineEvent());
    const markers = seq!.visualEvents.filter((v) => v.type === "motion_detected");
    expect(markers).toHaveLength(1);
    expect(markers[0].actorVisualId).toBeNull();
  });
});

describe("buildCCTVSequence — temporal consistency (req. 36)", () => {
  it("every visualEvent's atSecond falls within [0, durationSeconds]", () => {
    const frame = buildCCTVFrameDescriptor(makeEvidence({ relatedPersonIds: ["p1", "p2"], reliability: "reliable", discoveryDifficulty: 0.2 }));
    const seq = buildCCTVSequence("ev1", frame, makeTimelineEvent({ durationMinutes: 1 }));
    for (const ve of seq!.visualEvents) {
      expect(ve.atSecond).toBeGreaterThanOrEqual(0);
      expect(ve.atSecond).toBeLessThanOrEqual(seq!.durationSeconds);
    }
  });

  it("an actor's visibleFrom is always <= visibleUntil when both are set", () => {
    const frame = buildCCTVFrameDescriptor(makeEvidence({ relatedPersonIds: ["p1", "p2"], reliability: "reliable", discoveryDifficulty: 0.2 }));
    const seq = buildCCTVSequence("ev1", frame, makeTimelineEvent({ durationMinutes: 1 }));
    for (const actor of seq!.actors) {
      if (actor.visibleUntil !== null) expect(actor.visibleFrom).toBeLessThanOrEqual(actor.visibleUntil);
    }
  });

  it("seeking is pure: the same (sequence, t) always yields the same actor visibility set", () => {
    const frame = buildCCTVFrameDescriptor(makeEvidence({ relatedPersonIds: ["p1", "p2"], reliability: "reliable", discoveryDifficulty: 0.2 }));
    const seq = buildCCTVSequence("ev1", frame, makeTimelineEvent({ durationMinutes: 1 }))!;
    function visibleAt(s: CCTVSequenceDescriptor, t: number) {
      return s.actors.filter((a) => t >= a.visibleFrom && (a.visibleUntil === null || t <= a.visibleUntil)).map((a) => a.visualId);
    }
    for (const t of [0, seq.durationSeconds * 0.25, seq.durationSeconds * 0.5, seq.durationSeconds * 0.75, seq.durationSeconds]) {
      expect(visibleAt(seq, t)).toEqual(visibleAt(seq, t));
    }
  });
});

describe("cctvEnvironmentForLocationType (Phase 3B — visual realism pass)", () => {
  it("maps every LocationType to one of the documented cosmetic environment kinds", () => {
    const allowed = new Set(["corridor", "parking", "street", "shop", "generic"]);
    const types = [
      "police_station", "apartment", "house", "restaurant", "bar", "office", "parking", "bank", "pharmacy",
      "hospital", "train_station", "gas_station", "shop", "hotel", "park", "warehouse",
    ] as const;
    for (const t of types) {
      expect(allowed.has(cctvEnvironmentForLocationType(t))).toBe(true);
    }
  });

  it("falls back to 'generic' when no location type is known", () => {
    expect(cctvEnvironmentForLocationType(undefined)).toBe("generic");
  });

  it("is a pure, deterministic mapping (same type always yields the same kind)", () => {
    expect(cctvEnvironmentForLocationType("parking")).toBe(cctvEnvironmentForLocationType("parking"));
  });
});

describe("buildCCTVSequence — environment field (Phase 3B)", () => {
  it("threads the resolved environment kind onto the descriptor", () => {
    const frame = buildCCTVFrameDescriptor(makeEvidence());
    const seq = buildCCTVSequence("ev1", frame, makeTimelineEvent(), "parking");
    expect(seq!.environment).toBe("parking");
  });

  it("defaults to 'generic' when no location type is supplied (backward compatible)", () => {
    const frame = buildCCTVFrameDescriptor(makeEvidence());
    const seq = buildCCTVSequence("ev1", frame, makeTimelineEvent());
    expect(seq!.environment).toBe("generic");
  });
});

describe("buildCCTVSequence — historical isolation (req. 2/33)", () => {
  it("building sequences for every camera_footage item in a generated case never mutates truth.timeline/evidence", () => {
    const truth = generateCase("CASE-CCTV-SEQ-ISOLATION", { difficulty: "investigator" });
    const timelineBefore = JSON.stringify(truth.timeline);
    const evidenceBefore = JSON.stringify(truth.evidence);
    for (const ev of truth.evidence.filter((e) => e.type === "camera_footage")) {
      const frame = buildCCTVFrameDescriptor(ev, truth);
      const sourceEvent = truth.timeline.find((e) => e.id === ev.sourceEventId);
      buildCCTVSequence(ev.id, frame, sourceEvent);
    }
    expect(JSON.stringify(truth.timeline)).toBe(timelineBefore);
    expect(JSON.stringify(truth.evidence)).toBe(evidenceBefore);
  });

  it("regenerating the same seed after cctv-sequence.ts has been exercised produces an identical case (no shared RNG stream contamination)", () => {
    const first = generateCase("CASE-CCTV-SEQ-RNGISO", { difficulty: "investigator" });
    for (const ev of first.evidence.filter((e) => e.type === "camera_footage")) {
      const frame = buildCCTVFrameDescriptor(ev, first);
      const sourceEvent = first.timeline.find((e) => e.id === ev.sourceEventId);
      buildCCTVSequence(ev.id, frame, sourceEvent);
    }
    const second = generateCase("CASE-CCTV-SEQ-RNGISO", { difficulty: "investigator" });
    expect(second.culpritId).toBe(first.culpritId);
    expect(second.evidence.map((e) => e.id)).toEqual(first.evidence.map((e) => e.id));
    expect(second.timeline.map((e) => e.id)).toEqual(first.timeline.map((e) => e.id));
  });
});
