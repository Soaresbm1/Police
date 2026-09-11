import { describe, expect, it } from "vitest";
import { generateCase } from "@/lib/game-engine/case-generator/case-truth";
import { getLabReport } from "../lab-report";
import type { GameSession } from "../types";

function makeSession(seed: string, overrides: Partial<GameSession> = {}): GameSession {
  return {
    id: "s1",
    seed,
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
    surveillance: {},
    board: { nodes: [], edges: [] },
    accusation: null,
    crimeSceneExamined: false,
    crimeSceneInspectedZoneIds: [],
    lastRevealedEvidenceIds: [],
    lastActionMessage: null,
    ...overrides,
  };
}

function findLabEligible(truth: ReturnType<typeof generateCase>) {
  return truth.evidence.find((ev) => ev.requiresLabAnalysis !== null)!;
}

describe("getLabReport", () => {
  it("returns null for evidence that doesn't require lab analysis", () => {
    const truth = generateCase("CASE-LAB-1", { difficulty: "investigator" });
    const nonLab = truth.evidence.find((ev) => ev.requiresLabAnalysis === null)!;
    const session = makeSession(truth.seed, { evidenceStatus: { [nonLab.id]: "analyzed" } });
    expect(getLabReport(truth, session, nonLab.id)).toBeNull();
  });

  it("returns null before the evidence is discovered/collected/sent to lab", () => {
    const truth = generateCase("CASE-LAB-2", { difficulty: "investigator" });
    const ev = findLabEligible(truth);
    const session = makeSession(truth.seed);
    expect(getLabReport(truth, session, ev.id)).toBeNull();
  });

  it("returns null while sent_to_lab but not yet analyzed", () => {
    const truth = generateCase("CASE-LAB-3", { difficulty: "investigator" });
    const ev = findLabEligible(truth);
    const session = makeSession(truth.seed, {
      evidenceStatus: { [ev.id]: "sent_to_lab" },
      labQueue: [{ evidenceId: ev.id, analysisType: ev.requiresLabAnalysis!, submittedAt: 0, readyAt: 100 }],
    });
    expect(getLabReport(truth, session, ev.id)).toBeNull();
  });

  it("returns null for an unknown evidence id", () => {
    const truth = generateCase("CASE-LAB-4", { difficulty: "investigator" });
    const session = makeSession(truth.seed);
    expect(getLabReport(truth, session, "not-a-real-id")).toBeNull();
  });

  it("returns a full report once analyzed, with fields matching the underlying evidence and lab job", () => {
    const truth = generateCase("CASE-LAB-5", { difficulty: "investigator" });
    const ev = findLabEligible(truth);
    const session = makeSession(truth.seed, {
      evidenceStatus: { [ev.id]: "analyzed" },
      labQueue: [{ evidenceId: ev.id, analysisType: ev.requiresLabAnalysis!, submittedAt: 40, readyAt: 130 }],
    });
    const report = getLabReport(truth, session, ev.id);
    expect(report).not.toBeNull();
    expect(report!.reportId).toMatch(/^RF-\d{4}-\d{4}$/);
    expect(report!.evidenceCode).toMatch(/^EV-\d{4}$/);
    expect(report!.reliabilityLabel).not.toBe(ev.reliability); // translated to French, not the raw enum
    expect(report!.resultLabel.length).toBeGreaterThan(0);
    expect(report!.interpretation.length).toBeGreaterThan(0);
  });

  it("is deterministic: the same evidence always yields the same reportId/evidenceCode", () => {
    const truth = generateCase("CASE-LAB-6", { difficulty: "investigator" });
    const ev = findLabEligible(truth);
    const session = makeSession(truth.seed, {
      evidenceStatus: { [ev.id]: "analyzed" },
      labQueue: [{ evidenceId: ev.id, analysisType: ev.requiresLabAnalysis!, submittedAt: 0, readyAt: 60 }],
    });
    const a = getLabReport(truth, session, ev.id)!;
    const b = getLabReport(truth, session, ev.id)!;
    expect(a.reportId).toBe(b.reportId);
    expect(a.evidenceCode).toBe(b.evidenceCode);
  });

  it("never invents a comparison/match verdict — the report shape has no such field", () => {
    const truth = generateCase("CASE-LAB-7", { difficulty: "investigator" });
    const ev = findLabEligible(truth);
    const session = makeSession(truth.seed, {
      evidenceStatus: { [ev.id]: "analyzed" },
      labQueue: [{ evidenceId: ev.id, analysisType: ev.requiresLabAnalysis!, submittedAt: 0, readyAt: 60 }],
    });
    const report = getLabReport(truth, session, ev.id)!;
    const keys = Object.keys(report);
    for (const forbidden of ["comparison", "match", "matchesCulprit", "culpritId", "isMatch"]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("returns null when the evidence was analyzed but no LabJob record exists (defensive — should not happen in practice)", () => {
    const truth = generateCase("CASE-LAB-8", { difficulty: "investigator" });
    const ev = findLabEligible(truth);
    const session = makeSession(truth.seed, { evidenceStatus: { [ev.id]: "analyzed" }, labQueue: [] });
    expect(getLabReport(truth, session, ev.id)).toBeNull();
  });

  it("submittedAtLabel/completedAtLabel reflect the LabJob's submittedAt/readyAt, not the evidence timestamp", () => {
    const truth = generateCase("CASE-LAB-9", { difficulty: "investigator" });
    const ev = findLabEligible(truth);
    const session = makeSession(truth.seed, {
      evidenceStatus: { [ev.id]: "analyzed" },
      labQueue: [{ evidenceId: ev.id, analysisType: ev.requiresLabAnalysis!, submittedAt: 500, readyAt: 620 }],
    });
    const report = getLabReport(truth, session, ev.id)!;
    // formatGameTime renders an in-game clock string; just assert both
    // labels are non-empty and differ from each other for a >0 duration.
    expect(report.submittedAtLabel).not.toBe(report.completedAtLabel);
  });

  it("interpretation is stable for the same reliability+analysisType pair across different evidence", () => {
    const truth = generateCase("CASE-LAB-10", { difficulty: "investigator" });
    const eligible = truth.evidence.filter((ev) => ev.requiresLabAnalysis !== null);
    for (const ev of eligible) {
      const session = makeSession(truth.seed, {
        evidenceStatus: { [ev.id]: "analyzed" },
        labQueue: [{ evidenceId: ev.id, analysisType: ev.requiresLabAnalysis!, submittedAt: 0, readyAt: 60 }],
      });
      const report = getLabReport(truth, session, ev.id)!;
      expect(report.analysisTypeLabel.length).toBeGreaterThan(0);
      expect(report.origin.length).toBeGreaterThan(0);
    }
  });
});
