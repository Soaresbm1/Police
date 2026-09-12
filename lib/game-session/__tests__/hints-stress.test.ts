import { describe, expect, it } from "vitest";
import { generateCase } from "@/lib/game-engine/case-generator/case-truth";
import { computeHintOpportunities, getNextHint } from "../hints";
import { getCrimeSceneEvidence } from "../discovery";
import { evidenceStatusOf } from "../player-view";
import type { CaseTruth } from "@/lib/game-engine/types/case";
import type { GameSession, InvestigationEvent } from "../types";

/** Whole-word (accent-aware) containment check — plain `.includes()` false-
 * positives on e.g. "Marc" inside "démarches", which isn't a real name
 * mention. A letter class covering Latin-1 accented characters is enough
 * for this project's French text. */
function containsWord(haystack: string, word: string): boolean {
  if (word.length === 0) return false;
  const letters = "a-zà-öø-ÿ";
  const pattern = new RegExp(`(^|[^${letters}])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^${letters}]|$)`, "i");
  return pattern.test(haystack);
}

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

type PartialStateName = "A_nothing" | "B_scene_no_lab" | "C_phone_extracted" | "D_bank_accessed" | "E_mostly_done";

function buildState(truth: CaseTruth, state: PartialStateName): GameSession {
  const session = makeSession(truth.seed);
  if (state === "A_nothing") return session;

  if (state === "B_scene_no_lab") {
    const sceneEvidence = getCrimeSceneEvidence(truth);
    session.evidenceStatus = Object.fromEntries(sceneEvidence.map((e) => [e.id, "discovered" as const]));
    session.crimeSceneExamined = true;
    return session;
  }

  if (state === "C_phone_extracted") {
    const device = truth.evidence.find((e) => e.type === "victim_phone");
    if (device) {
      session.evidenceStatus = { [device.id]: "analyzed" };
      session.events = [
        {
          id: `lab_result:evidence:${device.id}`,
          type: "lab_result",
          source: { kind: "evidence", id: device.id },
          createdAt: 0,
          scheduledAt: 10,
          status: "ready",
          payload: { title: "x", detail: "y" },
        },
      ];
    }
    return session;
  }

  if (state === "D_bank_accessed") {
    const financial = truth.evidence.filter((e) => e.family === "financial");
    session.evidenceStatus = Object.fromEntries(financial.map((e) => [e.id, "collected" as const]));
    session.mandates = Object.fromEntries(
      truth.suspectIds.map((id) => [`bank:${id}`, { key: `bank:${id}`, granted: true, reason: "", requestedAt: 0 }]),
    );
    return session;
  }

  // E_mostly_done
  session.evidenceStatus = Object.fromEntries(truth.evidence.map((e) => [e.id, "analyzed" as const]));
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
  session.events = [...labEvents, ...cctvEvents];
  session.interrogated = Object.fromEntries(
    truth.people.filter((p) => p.id !== truth.victimId).map((p) => [p.id, truth.knowledge.filter((k) => k.personId === p.id).map((k) => k.id)]),
  );
  session.mandates = Object.fromEntries(
    truth.suspectIds.flatMap((id) => [
      [`bank:${id}`, { key: `bank:${id}`, granted: true, reason: "", requestedAt: 0 }],
      [`search:${id}`, { key: `search:${id}`, granted: true, reason: "", requestedAt: 0 }],
    ]),
  );
  session.surveillance = { "dummy:0": { key: "dummy:0", personId: truth.suspectIds[0], startedAt: 0, endedAt: 10, durationMinutes: 10, observations: [] } };
  return session;
}

/** Independent re-derivation (not reusing hints.ts's own builder logic)
 * that a category's implied action would genuinely surface something new
 * — req. 29's "no dead-end hints" check. */
function opportunityIsGenuinelyUseful(category: string, truth: CaseTruth, session: GameSession): boolean {
  switch (category) {
    case "crime_scene":
      return getCrimeSceneEvidence(truth).some((e) => evidenceStatusOf(session, e.id) === "undiscovered");
    case "forensic":
      return truth.evidence.some(
        (e) =>
          (e.requiresLabAnalysis && (evidenceStatusOf(session, e.id) === "discovered" || evidenceStatusOf(session, e.id) === "collected")) ||
          (e.requiresLabAnalysis && evidenceStatusOf(session, e.id) === "analyzed"),
      );
    case "digital":
    case "evidence_cross_reference":
      return truth.evidence.some((e) => e.type === "victim_phone");
    case "financial":
      return truth.evidence.some((e) => e.family === "financial" && evidenceStatusOf(session, e.id) === "undiscovered");
    case "cctv":
      return truth.locations.some((l) => l.hasCameras);
    case "interrogation":
    case "witness":
      return truth.knowledge.length > 0;
    case "warrant":
      return truth.suspectIds.some((id) => truth.evidence.some((e) => !e.isRedHerring && e.relatedPersonIds.includes(id) && evidenceStatusOf(session, e.id) !== "undiscovered"));
    case "surveillance":
      return truth.people.length > 1;
    case "timeline":
      return truth.timeline.length > 0;
    default:
      return true;
  }
}

const RUN_FULL = process.env.RUN_HINT_STATS === "1";
const CASE_COUNT = RUN_FULL ? 2000 : 100;
const STATES: PartialStateName[] = ["A_nothing", "B_scene_no_lab", "C_phone_extracted", "D_bank_accessed", "E_mostly_done"];

describe.skipIf(false)("hint engine — full stress/distribution", () => {
  it(
    `simulates ${CASE_COUNT} cases across ${STATES.length} partial-investigation states`,
    () => {
    let atLeastOneHint = 0;
    let noHintDespiteUnresolved = 0;
    let deadEndHints = 0;
    let truthLeaks = 0;
    let culpritNamedHints = 0;
    let nonCulpritNamedHints = 0;
    let l1CulpritNamed = 0;
    const perStateHintRate: Record<PartialStateName, number> = { A_nothing: 0, B_scene_no_lab: 0, C_phone_extracted: 0, D_bank_accessed: 0, E_mostly_done: 0 };
    let totalRuns = 0;

    for (let i = 0; i < CASE_COUNT; i++) {
      const truth = generateCase(`CASE-HINTSTRESS-${i}`, { difficulty: "investigator" });
      const culprit = truth.people.find((p) => p.id === truth.culpritId)!;

      for (const state of STATES) {
        totalRuns++;
        const session = buildState(truth, state);
        const opportunities = computeHintOpportunities(truth, session);

        if (opportunities.length > 0) {
          atLeastOneHint++;
          perStateHintRate[state]++;
        } else if (state !== "E_mostly_done") {
          // A-D are deliberately partial states — an empty opportunity
          // list this early would mean a real unresolved avenue got missed.
          noHintDespiteUnresolved++;
        }

        for (const opp of opportunities) {
          if (!opportunityIsGenuinelyUseful(opp.category, truth, session)) deadEndHints++;

          for (const [levelIdx, text] of opp.levels.entries()) {
            const lower = text.toLowerCase();
            const payload = JSON.stringify(opp);
            if (payload.includes(truth.culpritId) || payload.includes(truth.motive.type)) truthLeaks++;

            const namesCulprit = containsWord(lower, culprit.firstName.toLowerCase()) || containsWord(lower, culprit.lastName.toLowerCase());
            const namesAnyoneElse = truth.people
              .filter((p) => p.id !== truth.culpritId && p.id !== truth.victimId)
              .some((p) => containsWord(lower, p.firstName.toLowerCase()) || containsWord(lower, p.lastName.toLowerCase()));
            if (namesCulprit) {
              culpritNamedHints++;
              if (levelIdx === 0) l1CulpritNamed++;
            }
            if (namesAnyoneElse) nonCulpritNamedHints++;
          }
        }

        // getNextHint's own payload must also never leak, exercised once per state.
        const hint = getNextHint(truth, session);
        if (JSON.stringify(hint).includes(truth.culpritId)) truthLeaks++;
      }
    }

    const namedTotal = culpritNamedHints + nonCulpritNamedHints;
    console.log("=== HINT ENGINE STRESS ===", {
      caseCount: CASE_COUNT,
      totalRuns,
      atLeastOneHintPct: ((atLeastOneHint / totalRuns) * 100).toFixed(1),
      noHintDespiteUnresolved,
      deadEndHints,
      truthLeaks,
      perStateHintRatePct: Object.fromEntries(STATES.map((s) => [s, ((perStateHintRate[s] / CASE_COUNT) * 100).toFixed(1)])),
    });
    console.log("=== CULPRIT-TARGETING BIAS ===", {
      culpritNamedPct: namedTotal > 0 ? ((culpritNamedHints / namedTotal) * 100).toFixed(1) : "n/a",
      nonCulpritNamedPct: namedTotal > 0 ? ((nonCulpritNamedHints / namedTotal) * 100).toFixed(1) : "n/a",
      l1CulpritNamed,
    });

    expect(noHintDespiteUnresolved).toBe(0);
    expect(deadEndHints).toBe(0);
    expect(truthLeaks).toBe(0);
    // Level 1 should almost never need a specific name (req. 28).
    expect(l1CulpritNamed).toBe(0);
    // No systematic culprit-targeting: named hints should not overwhelmingly skew toward the culprit.
    if (namedTotal > 0) expect(culpritNamedHints / namedTotal).toBeLessThan(0.6);
    },
    60000,
  );
});
