import { describe, expect, it } from "vitest";
import { generateCase } from "../../case-generator/case-truth";
import type { CaseTruth } from "../../types/case";
import type { TimelineEvent } from "../../types/timeline";
import { isTaxonomyRelevantAction, safeVisualActionForMethod, selectReconstructionEventChain } from "../reconstruction-events";
import { findPocCase } from "./poc-case-finder";

function ev(partial: Partial<TimelineEvent> & Pick<TimelineEvent, "id" | "timestamp" | "actorId" | "locationId" | "action">): TimelineEvent {
  return {
    durationMinutes: 5,
    description: "",
    presentPersonIds: [partial.actorId],
    counterpartyId: null,
    involvedObject: null,
    observable: true,
    evidenceSourceTags: [],
    isCrimeEvent: false,
    ...partial,
  };
}

/** Minimal fixture exercising only the fields selectReconstructionEventChain
 * actually reads — a hand-crafted CaseTruth would need dozens of unrelated
 * required fields populated for no benefit here. */
function minimalTruth(overrides: {
  timeline: TimelineEvent[];
  culpritId: string;
  victimId: string;
  crimeLocationId: string;
  staged?: boolean;
  accompliceIds?: string[];
}): CaseTruth {
  return {
    timeline: overrides.timeline,
    culpritId: overrides.culpritId,
    victimId: overrides.victimId,
    crimeLocationId: overrides.crimeLocationId,
    staging: { type: overrides.staged ? "accident" : "none", staged: overrides.staged ?? false, tellEvidenceIds: [], description: "" },
    accompliceIds: overrides.accompliceIds ?? [],
  } as unknown as CaseTruth;
}

describe("selectReconstructionEventChain", () => {
  it("rejects a timeline with zero crime events", () => {
    const truth = minimalTruth({
      timeline: [ev({ id: "e1", timestamp: 100, actorId: "culprit", locationId: "loc1", action: "argument" })],
      culpritId: "culprit",
      victimId: "victim",
      crimeLocationId: "loc1",
    });
    const result = selectReconstructionEventChain(truth);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/exactly one/);
  });

  it("rejects a timeline with two crime events", () => {
    const truth = minimalTruth({
      timeline: [
        ev({ id: "e1", timestamp: 100, actorId: "culprit", locationId: "loc1", action: "attack", isCrimeEvent: true, counterpartyId: "victim" }),
        ev({ id: "e2", timestamp: 200, actorId: "culprit", locationId: "loc1", action: "attack", isCrimeEvent: true, counterpartyId: "victim" }),
      ],
      culpritId: "culprit",
      victimId: "victim",
      crimeLocationId: "loc1",
    });
    const result = selectReconstructionEventChain(truth);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/exactly one/);
  });

  it("rejects a crime event whose actor is not CaseTruth.culpritId", () => {
    const truth = minimalTruth({
      timeline: [ev({ id: "e1", timestamp: 100, actorId: "someone_else", locationId: "loc1", action: "attack", isCrimeEvent: true, counterpartyId: "victim" })],
      culpritId: "culprit",
      victimId: "victim",
      crimeLocationId: "loc1",
    });
    const result = selectReconstructionEventChain(truth);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/culpritId/);
  });

  it("rejects a crime event whose counterparty is not CaseTruth.victimId", () => {
    const truth = minimalTruth({
      timeline: [ev({ id: "e1", timestamp: 100, actorId: "culprit", locationId: "loc1", action: "attack", isCrimeEvent: true, counterpartyId: "someone_else" })],
      culpritId: "culprit",
      victimId: "victim",
      crimeLocationId: "loc1",
    });
    const result = selectReconstructionEventChain(truth);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/victimId/);
  });

  it("finds the closest preceding argument/meet at the crime location, ignoring an earlier unrelated meet elsewhere", () => {
    const truth = minimalTruth({
      timeline: [
        // Unrelated ordinary daily-routine "meet" at a different location — must not be picked.
        ev({ id: "unrelated", timestamp: 50, actorId: "culprit", locationId: "other_loc", action: "meet", presentPersonIds: ["culprit", "someone_else"] }),
        ev({ id: "confront", timestamp: 190, actorId: "culprit", locationId: "loc1", action: "argument", presentPersonIds: ["culprit", "victim"], counterpartyId: "victim" }),
        ev({ id: "attack", timestamp: 200, actorId: "culprit", locationId: "loc1", action: "attack", isCrimeEvent: true, counterpartyId: "victim", presentPersonIds: ["culprit", "victim"] }),
      ],
      culpritId: "culprit",
      victimId: "victim",
      crimeLocationId: "loc1",
    });
    const result = selectReconstructionEventChain(truth);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.meet?.event.id).toBe("confront");
    }
  });

  it("selects the earliest post-attack culprit travel from the crime location as leaveScene", () => {
    const truth = minimalTruth({
      timeline: [
        ev({ id: "attack", timestamp: 200, actorId: "culprit", locationId: "loc1", action: "attack", isCrimeEvent: true, counterpartyId: "victim", presentPersonIds: ["culprit", "victim"] }),
        ev({ id: "flee", timestamp: 205, actorId: "culprit", locationId: "loc1", action: "travel" }),
        ev({ id: "later_unrelated_travel", timestamp: 500, actorId: "culprit", locationId: "loc1", action: "travel" }),
      ],
      culpritId: "culprit",
      victimId: "victim",
      crimeLocationId: "loc1",
    });
    const result = selectReconstructionEventChain(truth);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.leaveScene?.event.id).toBe("flee");
  });

  it("never selects a fictitious travel event as leaveScene when the culprit never leaves the location in the timeline", () => {
    const truth = minimalTruth({
      timeline: [ev({ id: "attack", timestamp: 200, actorId: "culprit", locationId: "loc1", action: "attack", isCrimeEvent: true, counterpartyId: "victim", presentPersonIds: ["culprit", "victim"] })],
      culpritId: "culprit",
      victimId: "victim",
      crimeLocationId: "loc1",
    });
    const result = selectReconstructionEventChain(truth);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.leaveScene).toBeNull();
  });

  it("selects the earliest post-attack observe at the crime location as discover", () => {
    const truth = minimalTruth({
      timeline: [
        ev({ id: "attack", timestamp: 200, actorId: "culprit", locationId: "loc1", action: "attack", isCrimeEvent: true, counterpartyId: "victim", presentPersonIds: ["culprit", "victim"] }),
        ev({ id: "found", timestamp: 800, actorId: "discoverer", locationId: "loc1", action: "observe" }),
      ],
      culpritId: "culprit",
      victimId: "victim",
      crimeLocationId: "loc1",
    });
    const result = selectReconstructionEventChain(truth);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.discover?.event.id).toBe("found");
  });

  it("only includes staging when CaseTruth.staging.staged is true", () => {
    const timeline: TimelineEvent[] = [
      ev({ id: "attack", timestamp: 200, actorId: "culprit", locationId: "loc1", action: "attack", isCrimeEvent: true, counterpartyId: "victim", presentPersonIds: ["culprit", "victim"] }),
      ev({ id: "staged", timestamp: 210, actorId: "culprit", locationId: "loc1", action: "stage_scene" }),
    ];
    const staged = selectReconstructionEventChain(minimalTruth({ timeline, culpritId: "culprit", victimId: "victim", crimeLocationId: "loc1", staged: true }));
    expect(staged.ok).toBe(true);
    if (staged.ok) expect(staged.stageScene?.event.id).toBe("staged");

    const notStaged = selectReconstructionEventChain(minimalTruth({ timeline, culpritId: "culprit", victimId: "victim", crimeLocationId: "loc1", staged: false }));
    expect(notStaged.ok).toBe(true);
    if (notStaged.ok) expect(notStaged.stageScene).toBeNull();
  });

  it("only includes an accomplice when they appear in one of the anchored events, never merely because accompliceIds lists them", () => {
    const truth = minimalTruth({
      timeline: [
        ev({
          id: "attack",
          timestamp: 200,
          actorId: "culprit",
          locationId: "loc1",
          action: "attack",
          isCrimeEvent: true,
          counterpartyId: "victim",
          presentPersonIds: ["culprit", "victim", "lookout"],
        }),
      ],
      culpritId: "culprit",
      victimId: "victim",
      crimeLocationId: "loc1",
      accompliceIds: ["lookout", "driver_never_at_anchored_event"],
    });
    const result = selectReconstructionEventChain(truth);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.accompliceAppearances.has("lookout")).toBe(true);
      expect(result.accompliceAppearances.has("driver_never_at_anchored_event")).toBe(false);
    }
  });

  it("real generated cases always resolve to exactly one crime event chain", () => {
    for (let i = 0; i < 25; i++) {
      const truth = generateCase(`CASE-A${i.toString().padStart(5, "0")}`, { difficulty: "investigator" });
      const result = selectReconstructionEventChain(truth);
      expect(result.ok).toBe(true);
    }
  });
});

describe("isTaxonomyRelevantAction", () => {
  it("recognizes the actions the taxonomy covers", () => {
    for (const action of ["meet", "argument", "attack", "phone_call", "send_message", "travel", "observe", "stage_scene"] as const) {
      expect(isTaxonomyRelevantAction(action)).toBe(true);
    }
  });

  it("rejects ordinary daily-routine actions not part of the taxonomy", () => {
    for (const action of ["sleep", "wake_up", "work", "purchase", "withdraw_cash"] as const) {
      expect(isTaxonomyRelevantAction(action)).toBe(false);
    }
  });
});

describe("safeVisualActionForMethod", () => {
  it("maps every CrimeMethod to a defined safe visual action", () => {
    for (const method of ["blunt_force", "stabbing", "poisoning", "strangulation", "firearm", "fall_push", "staged_overdose"] as const) {
      expect(typeof safeVisualActionForMethod(method)).toBe("string");
      expect(safeVisualActionForMethod(method).length).toBeGreaterThan(0);
    }
  });

  it("never invents a delivery object for poisoning or staged_overdose", () => {
    const poisoning = safeVisualActionForMethod("poisoning");
    const overdose = safeVisualActionForMethod("staged_overdose");
    for (const action of [poisoning, overdose]) {
      expect(action).not.toMatch(/drink|glass|cup|syringe|food|injection/i);
    }
    // Both share one neutral action — no structured delivery-mechanism field exists in CaseTruth.
    expect(poisoning).toBe(overdose);
  });
});

describe("POC case fixture sanity", () => {
  it("the POC finder returns a case whose chain selection succeeds", () => {
    const match = findPocCase();
    expect(match).not.toBeNull();
    if (!match) return;
    const result = selectReconstructionEventChain(match.truth);
    expect(result.ok).toBe(true);
  });
});
