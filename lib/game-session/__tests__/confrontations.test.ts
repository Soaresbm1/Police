import { describe, expect, it } from "vitest";
import { generateCase } from "@/lib/game-engine/case-generator/case-truth";
import { deriveConfrontationOpportunities } from "@/lib/game-engine/witness/confrontations";
import type { CaseTruth } from "@/lib/game-engine/types/case";
import type { ConfrontationOpportunity } from "@/lib/game-engine/types/confrontation";
import { getConfrontationOptions, getPerformedConfrontations, performConfrontation } from "../confrontations";
import { readyUnseenCount, resolveEvents, scheduleEvent, visibleEvents } from "../events";
import type { GameSession } from "../types";

function makeSession(overrides: Partial<GameSession> = {}): GameSession {
  return {
    id: "s1",
    seed: "CASE-TEST01",
    difficulty: "investigator",
    createdAt: Date.now(),
    currentTime: 0,
    evidenceStatus: {},
    labQueue: [],
    events: [],
    notes: "",
    playerTimeline: [],
    interrogated: {},
    mandates: {},
    board: { nodes: [], edges: [] },
    accusation: null,
    crimeSceneExamined: false,
    crimeSceneInspectedZoneIds: [],
    lastRevealedEvidenceIds: [],
    lastActionMessage: null,
    ...overrides,
  };
}

function findCaseWith(kind: "alibi_conflict" | "evidence_backed_followup", requireLab = false): { truth: CaseTruth; op: ConfrontationOpportunity } {
  for (let i = 1; i <= 150; i++) {
    const seed = `CASE-SCF${String(i).padStart(4, "0")}`;
    const truth = generateCase(seed, { difficulty: "investigator" });
    const candidates = deriveConfrontationOpportunities(truth).filter((o) => o.relationKind === kind);
    const match = requireLab
      ? candidates.find((o) => truth.evidence.find((e) => e.id === o.evidenceId)?.requiresLabAnalysis)
      : candidates[0];
    if (match) return { truth, op: match };
  }
  throw new Error(`No case with a "${kind}"${requireLab ? " (lab-gated)" : ""} confrontation opportunity found in sweep`);
}

function eligibleSession(truth: CaseTruth, op: ConfrontationOpportunity, evidenceStatus: "discovered" | "analyzed" = "discovered"): GameSession {
  return makeSession({
    interrogated: { [op.personId]: [op.factId] },
    evidenceStatus: { [op.evidenceId]: evidenceStatus },
  });
}

describe("getConfrontationOptions: eligibility gating", () => {
  it("returns nothing before the statement has ever been asked, even if the evidence is fully discovered", () => {
    const { truth, op } = findCaseWith("evidence_backed_followup");
    const session = makeSession({ evidenceStatus: { [op.evidenceId]: "discovered" } });
    expect(getConfrontationOptions(truth, session, op.personId)).toHaveLength(0);
  });

  it("returns nothing before the evidence is discovered, even if the statement was asked", () => {
    const { truth, op } = findCaseWith("evidence_backed_followup");
    const session = makeSession({ interrogated: { [op.personId]: [op.factId] } });
    expect(getConfrontationOptions(truth, session, op.personId)).toHaveLength(0);
  });

  it("returns the option once both the statement is asked and the evidence is discovered", () => {
    const { truth, op } = findCaseWith("evidence_backed_followup");
    const session = eligibleSession(truth, op);
    const options = getConfrontationOptions(truth, session, op.personId);
    expect(options).toHaveLength(1);
    expect(options[0].opportunityId).toBe(op.id);
    expect(options[0].evidenceId).toBe(op.evidenceId);
  });

  it("evidence requiring lab analysis is not confrontable merely 'discovered' or 'collected' — only once 'analyzed'", () => {
    const { truth, op } = findCaseWith("evidence_backed_followup", true);
    const discovered = eligibleSession(truth, op, "discovered");
    expect(getConfrontationOptions(truth, discovered, op.personId)).toHaveLength(0);

    const collected = eligibleSession(truth, op, "discovered");
    collected.evidenceStatus[op.evidenceId] = "collected";
    expect(getConfrontationOptions(truth, collected, op.personId)).toHaveLength(0);

    const sentToLab = eligibleSession(truth, op, "discovered");
    sentToLab.evidenceStatus[op.evidenceId] = "sent_to_lab";
    expect(getConfrontationOptions(truth, sentToLab, op.personId)).toHaveLength(0);

    const analyzed = eligibleSession(truth, op, "analyzed");
    expect(getConfrontationOptions(truth, analyzed, op.personId)).toHaveLength(1);
  });

  it("never leaks a confrontation option for a person the opportunity doesn't belong to", () => {
    const { truth, op } = findCaseWith("evidence_backed_followup");
    const otherPerson = truth.people.find((p) => p.id !== op.personId)!;
    const session = eligibleSession(truth, op);
    expect(getConfrontationOptions(truth, session, otherPerson.id)).toHaveLength(0);
  });

  it("the option view never exposes the predetermined reaction or reactionKind before it's performed", () => {
    const { truth, op } = findCaseWith("evidence_backed_followup");
    const session = eligibleSession(truth, op);
    const view = getConfrontationOptions(truth, session, op.personId)[0] as unknown as Record<string, unknown>;
    expect(view.reaction).toBeUndefined();
    expect(view.reactionKind).toBeUndefined();
  });
});

describe("performConfrontation", () => {
  it("returns null for a stale/tampered opportunity id that doesn't exist", () => {
    const { truth, op } = findCaseWith("evidence_backed_followup");
    const session = eligibleSession(truth, op);
    expect(performConfrontation(truth, session, op.personId, "confront:does-not-exist:ev1")).toBeNull();
  });

  it("returns null when the opportunity exists but isn't currently eligible (not asked yet)", () => {
    const { truth, op } = findCaseWith("evidence_backed_followup");
    const session = makeSession({ evidenceStatus: { [op.evidenceId]: "discovered" } });
    expect(performConfrontation(truth, session, op.personId, op.id)).toBeNull();
  });

  it("performs an eligible confrontation and returns the exact predetermined reaction", () => {
    const { truth, op } = findCaseWith("evidence_backed_followup");
    const session = eligibleSession(truth, op);
    const result = performConfrontation(truth, session, op.personId, op.id);
    expect(result).not.toBeNull();
    expect(result!.reaction).toBe(op.reaction);
    expect(result!.reactionKind).toBe(op.reactionKind);
  });

  it("a performed confrontation disappears from options and appears in performed history", () => {
    const { truth, op } = findCaseWith("evidence_backed_followup");
    const session = eligibleSession(truth, op);
    performConfrontation(truth, session, op.personId, op.id);

    expect(getConfrontationOptions(truth, session, op.personId)).toHaveLength(0);
    const performed = getPerformedConfrontations(truth, session, op.personId);
    expect(performed).toHaveLength(1);
    expect(performed[0].reaction).toBe(op.reaction);
  });

  it("cannot be performed twice — the second call returns the same reaction, no duplicate record", () => {
    const { truth, op } = findCaseWith("evidence_backed_followup");
    const session = eligibleSession(truth, op);
    const first = performConfrontation(truth, session, op.personId, op.id);
    const eventCountAfterFirst = session.events.length;
    const second = performConfrontation(truth, session, op.personId, op.id);
    expect(second).toEqual(first);
    expect(session.events.length).toBe(eventCountAfterFirst);
    expect(getPerformedConfrontations(truth, session, op.personId)).toHaveLength(1);
  });

  it("advancing time / reloading (re-reading the same session) preserves the performed confrontation", () => {
    const { truth, op } = findCaseWith("evidence_backed_followup");
    const session = eligibleSession(truth, op);
    performConfrontation(truth, session, op.personId, op.id);
    session.currentTime += 500;
    resolveEvents(session);
    for (let i = 0; i < 3; i++) {
      expect(getPerformedConfrontations(truth, session, op.personId)).toHaveLength(1);
      expect(getConfrontationOptions(truth, session, op.personId)).toHaveLength(0);
    }
  });

  it("a lie-based (alibi_conflict) confrontation always yields maintains_statement — never an admission", () => {
    const { truth, op } = findCaseWith("alibi_conflict");
    const session = eligibleSession(truth, op);
    const result = performConfrontation(truth, session, op.personId, op.id);
    expect(result!.reactionKind).toBe("maintains_statement");
  });

  it("performing a confrontation does not depend on session.accusation in any way", () => {
    const { truth, op } = findCaseWith("evidence_backed_followup");
    const otherSuspect = truth.suspectIds.find((id) => id !== op.personId) ?? truth.suspectIds[0];
    const plain = eligibleSession(truth, op);
    const accusing = eligibleSession(truth, op);
    accusing.accusation = { culpritId: otherSuspect, motiveType: "greed", method: "poison", accomplices: [], submittedAt: 0 };

    const plainResult = performConfrontation(truth, plain, op.personId, op.id);
    const accusingResult = performConfrontation(truth, accusing, op.personId, op.id);
    expect(plainResult!.reaction).toBe(accusingResult!.reaction);
    expect(plainResult!.reactionKind).toBe(accusingResult!.reactionKind);
  });
});

describe("UI terminology honestly distinguishes a proven contradiction from a mere follow-up", () => {
  it("an alibi_conflict option/result is always labeled 'Confronter'/'Confronté avec' — a real, proven contradiction", () => {
    const { truth, op } = findCaseWith("alibi_conflict");
    const session = eligibleSession(truth, op);
    const option = getConfrontationOptions(truth, session, op.personId)[0];
    expect(option.actionLabel).toBe("Confronter");

    const result = performConfrontation(truth, session, op.personId, op.id);
    expect(result!.resultLabel).toBe("Confronté avec");
  });

  it("an evidence_backed_followup option/result is never labeled 'Confronter' — same-event relevance is not a proven contradiction", () => {
    const { truth, op } = findCaseWith("evidence_backed_followup");
    const session = eligibleSession(truth, op);
    const option = getConfrontationOptions(truth, session, op.personId)[0];
    expect(option.actionLabel).toBe("Relancer");
    expect(option.actionLabel).not.toBe("Confronter");

    const result = performConfrontation(truth, session, op.personId, op.id);
    expect(result!.resultLabel).toBe("Relancé avec");
    expect(result!.resultLabel).not.toContain("Confront");
  });
});

describe("confrontation events stay out of the generic Activity inbox/badge", () => {
  it("a performed confrontation never appears in visibleEvents or readyUnseenCount", () => {
    const { truth, op } = findCaseWith("evidence_backed_followup");
    const session = eligibleSession(truth, op);
    performConfrontation(truth, session, op.personId, op.id);

    expect(visibleEvents(session).some((e) => e.type === "confrontation")).toBe(false);
    expect(readyUnseenCount(session)).toBe(0);
  });

  it("the confrontation exclusion is type-specific — other Phase 1-3 event types remain visible as before", () => {
    const session = makeSession({ currentTime: 0 });
    const PAYLOAD = { title: "LABORATOIRE — Analyse terminée", detail: "Résultat disponible." };
    scheduleEvent(session, "lab_result", { kind: "evidence", id: "ev1" }, 0, PAYLOAD);
    resolveEvents(session);

    expect(visibleEvents(session).some((e) => e.type === "lab_result")).toBe(true);
    expect(readyUnseenCount(session)).toBe(1);
  });
});
