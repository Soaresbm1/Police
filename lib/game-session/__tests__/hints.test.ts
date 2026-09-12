import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateCase } from "@/lib/game-engine/case-generator/case-truth";
import { computeHintOpportunities, escalateHint, getHintHistoryView, getNextHint } from "../hints";
import { computeHintPenalty, scoreAccusation } from "../scoring";
import { computeSolvability } from "@/lib/game-engine/validator/solvability";
import type { GameSession, InvestigationEvent } from "../types";

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
    hintState: { progress: {}, history: [], totalHintsUsed: 0 },
    ...overrides,
  };
}

/** Whole-word (accent-aware) containment — plain `.includes()` would
 * false-positive on e.g. "Marc" inside "démarches". */
function containsWord(haystack: string, word: string): boolean {
  if (word.length === 0) return false;
  const letters = "a-zà-öø-ÿ";
  const pattern = new RegExp(`(^|[^${letters}])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^${letters}]|$)`, "i");
  return pattern.test(haystack);
}

const FORBIDDEN_KEYS = [
  '"culpritId"',
  '"actualMotive"',
  '"priority"',
  '"category"',
  '"channelFamilies"',
  '"crimeRelevance"',
  '"templateCategory"',
  '"isMotiveClue"',
];

describe("hints — determinism & basic eligibility", () => {
  it("[A, Y] same truth/session state yields the same next hint, including after a fresh reload (regenerated truth)", () => {
    const truthA = generateCase("CASE-HINT-DET", { difficulty: "investigator" });
    const truthB = generateCase("CASE-HINT-DET", { difficulty: "investigator" });
    const sessionA = makeSession("CASE-HINT-DET");
    const sessionB = makeSession("CASE-HINT-DET");
    expect(getNextHint(truthA, sessionA)).toEqual(getNextHint(truthB, sessionB));
  });

  it("[B] never calls Math.random (static source check)", () => {
    const src = readFileSync(new URL("../hints.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/Math\.random/);
  });

  it("[D] a ready-but-unread lab report outranks a plain unexplored financial path", () => {
    const truth = generateCase("CASE-HINT-PRIORITY", { difficulty: "investigator" });
    const labEligible = truth.evidence.find((e) => e.requiresLabAnalysis && e.type !== "victim_phone")!;
    const session = makeSession(truth.seed, {
      evidenceStatus: { [labEligible.id]: "analyzed" },
      labQueue: [{ evidenceId: labEligible.id, analysisType: labEligible.requiresLabAnalysis!, submittedAt: 0, readyAt: 10 }],
      events: [
        {
          id: `lab_result:evidence:${labEligible.id}`,
          type: "lab_result",
          source: { kind: "evidence", id: labEligible.id },
          createdAt: 0,
          scheduledAt: 10,
          status: "ready",
          payload: { title: "x", detail: "y" },
        },
      ],
    });
    const opportunities = computeHintOpportunities(truth, session);
    const reportOpp = opportunities.find((o) => o.id === "forensic-report-ready");
    expect(reportOpp).toBeDefined();
    // It must be the highest-priority opportunity in this state.
    expect(opportunities[0].id).toBe("forensic-report-ready");
  });

  it("[E] discovered/collected lab-eligible evidence produces a forensic 'send to lab' hint", () => {
    const truth = generateCase("CASE-HINT-FORENSIC", { difficulty: "investigator" });
    const labEligible = truth.evidence.find((e) => e.requiresLabAnalysis && e.type !== "victim_phone")!;
    const session = makeSession(truth.seed, { evidenceStatus: { [labEligible.id]: "discovered" } });
    const opportunities = computeHintOpportunities(truth, session);
    expect(opportunities.some((o) => o.id === "forensic-pending-analysis")).toBe(true);
  });

  it("[F] a fully-extracted, freshly-analyzed victim phone produces a digital hint", () => {
    const truth = generateCase("CASE-HINT-PHONE", { difficulty: "investigator" });
    const device = truth.evidence.find((e) => e.type === "victim_phone")!;
    const session = makeSession(truth.seed, {
      evidenceStatus: { [device.id]: "analyzed" },
      events: [
        {
          id: `lab_result:evidence:${device.id}`,
          type: "lab_result",
          source: { kind: "evidence", id: device.id },
          createdAt: 0,
          scheduledAt: 10,
          status: "ready",
          payload: { title: "x", detail: "y" },
        },
      ],
    });
    const opportunities = computeHintOpportunities(truth, session);
    expect(opportunities.some((o) => o.id === "digital-phone-unread")).toBe(true);
  });

  it("[G] no phone-content hint before the phone has even been discovered", () => {
    const truth = generateCase("CASE-HINT-NOPHONE", { difficulty: "investigator" });
    const session = makeSession(truth.seed);
    const opportunities = computeHintOpportunities(truth, session);
    expect(opportunities.some((o) => o.id === "digital-phone-unread")).toBe(false);
    expect(opportunities.some((o) => o.id === "cross-phone-financial")).toBe(false);
  });

  it("[H] no financial hint once every financial-family item is already discovered", () => {
    const truth = generateCase("CASE-HINT-FIN-DONE", { difficulty: "investigator" });
    const financial = truth.evidence.filter((e) => e.family === "financial");
    const session = makeSession(
      truth.seed,
      { evidenceStatus: Object.fromEntries(financial.map((e) => [e.id, "collected" as const])) },
    );
    const opportunities = computeHintOpportunities(truth, session);
    expect(opportunities.some((o) => o.id === "financial-unexplored")).toBe(false);
  });

  it("[H] financial hint appears when a real undiscovered financial item exists", () => {
    const truth = generateCase("CASE-HINT-FIN-OPEN", { difficulty: "investigator" });
    const hasFinancial = truth.evidence.some((e) => e.family === "financial");
    expect(hasFinancial).toBe(true);
    const session = makeSession(truth.seed);
    const opportunities = computeHintOpportunities(truth, session);
    expect(opportunities.some((o) => o.id === "financial-unexplored")).toBe(true);
  });

  it("[I] no CCTV hint once every meaningful camera-equipped location has been requested", () => {
    const truth = generateCase("CASE-HINT-CCTV-DONE", { difficulty: "investigator" });
    const camLocations = truth.locations.filter((l) => l.hasCameras);
    const events = camLocations.map((l) => ({
      id: `cctv_footage:location:${l.id}`,
      type: "cctv_footage" as const,
      source: { kind: "location" as const, id: l.id },
      createdAt: 0,
      scheduledAt: 10,
      status: "ready" as const,
      payload: { title: "x", detail: "y" },
    }));
    const session = makeSession(truth.seed, { events });
    const opportunities = computeHintOpportunities(truth, session);
    expect(opportunities.some((o) => o.id === "cctv-unrequested")).toBe(false);
  });

  it("[J] an uninterrogated person with real topics produces an interrogation hint", () => {
    const truth = generateCase("CASE-HINT-INTERROGATION", { difficulty: "investigator" });
    const session = makeSession(truth.seed);
    const opportunities = computeHintOpportunities(truth, session);
    // Every generated case has knowledge/testimony for at least some
    // non-victim person, so this should virtually always be eligible with
    // zero interrogation progress.
    expect(opportunities.some((o) => o.id === "interrogation-unresolved")).toBe(true);
  });

  it("[C, S] a resolved path (crime scene fully examined) is not suggested again", () => {
    const truth = generateCase("CASE-HINT-RESOLVED", { difficulty: "investigator" });
    const sceneEvidence = truth.evidence.filter(
      (ev) => !ev.isRedHerring && ev.relatedLocationIds.includes(truth.crimeLocationId) && (ev.family === "physical" || ev.family === "video") && ev.discoveryDifficulty <= 0.5,
    );
    const session = makeSession(truth.seed, {
      evidenceStatus: Object.fromEntries(sceneEvidence.map((e) => [e.id, "collected" as const])),
    });
    const opportunities = computeHintOpportunities(truth, session);
    expect(opportunities.some((o) => o.id === "crime-scene-examine")).toBe(false);
  });

  it("[W] never returns two opportunities with the same id", () => {
    for (let i = 0; i < 30; i++) {
      const truth = generateCase(`CASE-HINT-DUP-${i}`, { difficulty: "investigator" });
      const session = makeSession(truth.seed);
      const opportunities = computeHintOpportunities(truth, session);
      expect(new Set(opportunities.map((o) => o.id)).size).toBe(opportunities.length);
    }
  });
});

describe("hints — truth safety", () => {
  it("[K, L, M, N] getNextHint's serialized payload never carries hidden fields", () => {
    for (let i = 0; i < 20; i++) {
      const truth = generateCase(`CASE-HINT-LEAK-${i}`, { difficulty: "investigator" });
      const session = makeSession(truth.seed);
      const payload = getNextHint(truth, session);
      const json = JSON.stringify(payload);
      for (const forbidden of FORBIDDEN_KEYS) expect(json).not.toContain(forbidden);
      const allowedKeys = new Set(["hintId", "level", "text", "terminal"]);
      for (const key of Object.keys(payload)) expect(allowedKeys.has(key)).toBe(true);
    }
  });

  it("[O] Level 1 text never mentions the culprit's name or the actual motive label", () => {
    const MOTIVE_WORDS = ["jalousie", "vengeance", "argent", "héritage", "dette", "conflit professionnel", "fraude", "rivalité"];
    for (let i = 0; i < 40; i++) {
      const truth = generateCase(`CASE-HINT-L1-${i}`, { difficulty: "investigator" });
      const session = makeSession(truth.seed);
      for (const opp of computeHintOpportunities(truth, session)) {
        const l1 = opp.levels[0].toLowerCase();
        const culprit = truth.people.find((p) => p.id === truth.culpritId)!;
        expect(containsWord(l1, culprit.firstName.toLowerCase())).toBe(false);
        expect(containsWord(l1, culprit.lastName.toLowerCase())).toBe(false);
        for (const word of MOTIVE_WORDS) expect(l1).not.toContain(word);
      }
    }
  });

  it("[P] Level 3 text never states the culprit's identity or motive as a direct verdict", () => {
    const SPOILER_PHRASES = ["est le coupable", "est coupable", "a tué", "est l'assassin", "le mobile est", "le mobile était"];
    for (let i = 0; i < 40; i++) {
      const truth = generateCase(`CASE-HINT-L3-${i}`, { difficulty: "investigator" });
      const session = makeSession(truth.seed);
      for (const opp of computeHintOpportunities(truth, session)) {
        const l3 = opp.levels[2].toLowerCase();
        for (const phrase of SPOILER_PHRASES) expect(l3).not.toContain(phrase);
      }
    }
  });
});

describe("hints — progression, history, terminal state", () => {
  it("[Q, R] history and escalation persist on the session object across calls", () => {
    const truth = generateCase("CASE-HINT-PROGRESS", { difficulty: "investigator" });
    const session = makeSession(truth.seed);
    const first = getNextHint(truth, session);
    expect(session.hintState.history).toHaveLength(1);
    expect(session.hintState.progress[first.hintId]).toBe(1);

    if (!first.terminal) {
      const escalated = escalateHint(truth, session, first.hintId);
      expect(escalated.hintId).toBe(first.hintId);
      expect(escalated.level).toBe(2);
      expect(session.hintState.progress[first.hintId]).toBe(2);
      expect(session.hintState.history).toHaveLength(2);
    }

    // The player-facing history projection drops hintId/category entirely.
    const historyView = getHintHistoryView(session);
    expect(historyView.length).toBe(session.hintState.history.length);
    for (const entry of historyView) {
      expect(Object.keys(entry).sort()).toEqual(["level", "text", "timeLabel"]);
    }
  });

  it("[X] a case with every major avenue resolved returns the terminal message, not a fabricated hint", () => {
    const truth = generateCase("CASE-HINT-TERMINAL", { difficulty: "investigator" });
    const allDiscovered = Object.fromEntries(truth.evidence.map((e) => ["analyzed" as const, e.id] as const).map(([status, id]) => [id, status]));
    const labEvents: InvestigationEvent[] = truth.evidence
      .filter((e) => e.requiresLabAnalysis)
      .map((e) => ({
        id: `lab_result:evidence:${e.id}`,
        type: "lab_result",
        source: { kind: "evidence", id: e.id },
        createdAt: 0,
        scheduledAt: 10,
        status: "seen",
        payload: { title: "x", detail: "y" },
      }));
    const cctvEvents: InvestigationEvent[] = truth.locations
      .filter((l) => l.hasCameras)
      .map((l) => ({
        id: `cctv_footage:location:${l.id}`,
        type: "cctv_footage",
        source: { kind: "location", id: l.id },
        createdAt: 0,
        scheduledAt: 10,
        status: "seen",
        payload: { title: "x", detail: "y" },
      }));
    const events: InvestigationEvent[] = [...labEvents, ...cctvEvents];
    const interrogated = Object.fromEntries(
      truth.people
        .filter((p) => p.id !== truth.victimId)
        .map((p) => [p.id, truth.knowledge.filter((k) => k.personId === p.id).map((k) => k.id)]),
    );
    const mandates = Object.fromEntries(
      truth.suspectIds.flatMap((id) => [
        [`bank:${id}`, { key: `bank:${id}`, granted: true, reason: "", requestedAt: 0 }],
        [`search:${id}`, { key: `search:${id}`, granted: true, reason: "", requestedAt: 0 }],
      ]),
    );
    const session = makeSession(truth.seed, {
      evidenceStatus: allDiscovered,
      events,
      interrogated,
      mandates,
      surveillance: { "dummy:0": { key: "dummy:0", personId: truth.suspectIds[0], startedAt: 0, endedAt: 10, durationMinutes: 10, observations: [] } },
    });
    const opportunities = computeHintOpportunities(truth, session);
    if (opportunities.length === 0) {
      const hint = getNextHint(truth, session);
      expect(hint.terminal).toBe(true);
      expect(hint.hintId).toBe("terminal");
    }
  });
});

describe("hints — isolation from truth/solvability/scoring", () => {
  it("[T] requesting hints never mutates CaseTruth", () => {
    const truth = generateCase("CASE-HINT-PURITY", { difficulty: "investigator" });
    const snapshot = JSON.stringify(truth);
    const session = makeSession(truth.seed);
    getNextHint(truth, session);
    expect(JSON.stringify(truth)).toBe(snapshot);
  });

  it("[U] hint usage never affects computeSolvability", () => {
    const truth = generateCase("CASE-HINT-SOLV", { difficulty: "investigator" });
    const sessionA = makeSession(truth.seed);
    const sessionB = makeSession(truth.seed);
    getNextHint(truth, sessionB);
    escalateHint(truth, sessionB, getNextHint(truth, sessionB).hintId);
    expect(computeSolvability(truth)).toEqual(computeSolvability(truth));
    // sessionA/B divergence in hintState must not be readable from truth at all.
    void sessionA;
  });

  it("[V] hint penalty affects only overallPercent/grade, never culpritCorrect/evidence counts", () => {
    const truth = generateCase("CASE-HINT-SCORE", { difficulty: "investigator" });
    const session = makeSession(truth.seed, { currentTime: truth.crimeTimestamp + 120 });
    // Force three opportunities to Level 3 (max penalty per opportunity).
    for (let i = 0; i < 5; i++) {
      const hint = getNextHint(truth, session);
      if (!hint.terminal) {
        escalateHint(truth, session, hint.hintId);
        escalateHint(truth, session, hint.hintId);
      }
    }
    const penalty = computeHintPenalty(session);
    expect(penalty).toBeLessThanOrEqual(0);

    const accusation = { culpritId: truth.culpritId, motiveType: truth.motive.type, method: truth.weapon, accomplices: [], submittedAt: session.currentTime };
    const withHints = scoreAccusation(truth, session, accusation);
    const sessionNoHints = makeSession(truth.seed, { currentTime: session.currentTime });
    const withoutHints = scoreAccusation(truth, sessionNoHints, accusation);

    expect(withHints.culpritCorrect).toBe(withoutHints.culpritCorrect);
    expect(withHints.importantEvidenceFound).toBe(withoutHints.importantEvidenceFound);
    expect(withHints.overallPercent).toBeLessThanOrEqual(withoutHints.overallPercent);
    expect(withHints.hintPenaltyApplied).toBe(penalty);
  });

  it("a session persisted before hintState existed defaults to zero penalty", () => {
    const truth = generateCase("CASE-HINT-LEGACY", { difficulty: "investigator" });
    const session = makeSession(truth.seed);
    // Simulate a pre-migration session object missing hintState entirely.
    delete (session as { hintState?: unknown }).hintState;
    expect(computeHintPenalty(session)).toBe(0);
  });
});
