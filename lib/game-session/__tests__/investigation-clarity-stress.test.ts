import { describe, expect, it } from "vitest";
import { generateCase } from "@/lib/game-engine/case-generator/case-truth";
import { getLabReport } from "../lab-report";
import { getSuspects, getVisibleEvidence, getWitnesses } from "../player-view";
import { ACCUSATION_PERSON_ORDER_DOMAIN } from "../ordering";
import { buildCCTVFrameDescriptor, describeCCTVObservation, identifiedNamesForCCTV } from "@/lib/art/cctv";
import type { GameSession } from "../types";

/**
 * Player-test feedback pass, diagnostics run (project brief §24). Large-
 * scale — 2,000+ generated cases for the ordering distribution, 2,000+
 * ordering samples, 500+ lab/financial/CCTV workflow exercises — so this
 * is gated behind an env var and skipped by default, the same convention
 * `case-variety-stats.test.ts` already established for its own 5k-10k
 * run. Run on demand with:
 *   RUN_CLARITY_STATS=1 npx vitest run lib/game-session/__tests__/investigation-clarity-stress.test.ts
 */
const RUN_FULL = process.env.RUN_CLARITY_STATS === "1";
const CASE_COUNT = RUN_FULL ? 2000 : 60;
const WORKFLOW_COUNT = RUN_FULL ? 500 : 30;

const FORBIDDEN_SUBSTRINGS = [
  '"culpritId"',
  '"actualMotive"',
  '"roles"',
  '"relevantToCrime"',
  '"suspicious"',
  '"motiveLink"',
  '"culpritLink"',
  '"fabricatedTruth"',
  '"isTruthful"',
  '"comparison"',
  '"match"',
];

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

describe.skipIf(false)("investigation clarity pass — diagnostics", () => {
  it(`culprit-position distribution across ${CASE_COUNT} cases (suspect-list vs accusation domains) + truth-safety payload audit`, () => {
    let thrown = 0;
    let leaked = 0;
    const listPos = { first: 0, middle: 0, last: 0 };
    const accusationPos = { first: 0, middle: 0, last: 0 };
    let domainsDiffer = 0;

    for (let i = 0; i < CASE_COUNT; i++) {
      try {
        const truth = generateCase(`CASE-CLARITY-ORDER-${i}`, { difficulty: "investigator" });

        const listSuspects = getSuspects(truth);
        const accusationSuspects = getSuspects(truth, ACCUSATION_PERSON_ORDER_DOMAIN);

        const listIdx = listSuspects.findIndex((s) => s.id === truth.culpritId);
        const accIdx = accusationSuspects.findIndex((s) => s.id === truth.culpritId);
        const bucket = (idx: number, len: number) => (idx === 0 ? "first" : idx === len - 1 ? "last" : "middle");
        listPos[bucket(listIdx, listSuspects.length)]++;
        accusationPos[bucket(accIdx, accusationSuspects.length)]++;

        if (listSuspects.map((s) => s.id).join(",") !== accusationSuspects.map((s) => s.id).join(",")) domainsDiffer++;

        const payload = JSON.stringify({
          suspects: listSuspects,
          witnesses: getWitnesses(truth),
        });
        for (const forbidden of FORBIDDEN_SUBSTRINGS) {
          if (payload.includes(forbidden)) leaked++;
        }
      } catch {
        thrown++;
      }
    }

    console.log("=== ORDERING DISTRIBUTION (suspect-list-order) ===", {
      firstPct: ((listPos.first / CASE_COUNT) * 100).toFixed(1),
      middlePct: ((listPos.middle / CASE_COUNT) * 100).toFixed(1),
      lastPct: ((listPos.last / CASE_COUNT) * 100).toFixed(1),
    });
    console.log("=== ORDERING DISTRIBUTION (accusation-person-order) ===", {
      firstPct: ((accusationPos.first / CASE_COUNT) * 100).toFixed(1),
      middlePct: ((accusationPos.middle / CASE_COUNT) * 100).toFixed(1),
      lastPct: ((accusationPos.last / CASE_COUNT) * 100).toFixed(1),
    });
    console.log("domains differ (list vs accusation) in", `${((domainsDiffer / CASE_COUNT) * 100).toFixed(1)}%`, "of cases");
    console.log("thrown:", thrown, "leaked payload fields:", leaked);

    expect(thrown).toBe(0);
    expect(leaked).toBe(0);
    // No systematic first-position bias — a guilt-derived or generation-
    // order-derived placement would push this close to 100%.
    expect(listPos.first / CASE_COUNT).toBeLessThan(0.6);
    expect(accusationPos.first / CASE_COUNT).toBeLessThan(0.6);
  });

  it(`lab / financial / CCTV workflow exercise across ${WORKFLOW_COUNT} generated cases`, () => {
    let thrown = 0;
    let leaked = 0;
    let labWorkflowsChecked = 0;
    let financialItemsChecked = 0;
    let cctvItemsChecked = 0;

    for (let i = 0; i < WORKFLOW_COUNT; i++) {
      try {
        const truth = generateCase(`CASE-CLARITY-WORKFLOW-${i}`, { difficulty: "investigator" });

        // Lab report workflow: every lab-eligible evidence, once analyzed,
        // must produce a safe report with no thrown error and no leaked field.
        const labEligible = truth.evidence.filter((ev) => ev.requiresLabAnalysis !== null);
        for (const ev of labEligible) {
          const session = makeSession(truth.seed, {
            evidenceStatus: { [ev.id]: "analyzed" },
            labQueue: [{ evidenceId: ev.id, analysisType: ev.requiresLabAnalysis!, submittedAt: 0, readyAt: 60 }],
          });
          const report = getLabReport(truth, session, ev.id);
          expect(report).not.toBeNull();
          const payload = JSON.stringify(report);
          for (const forbidden of FORBIDDEN_SUBSTRINGS) {
            if (payload.includes(forbidden)) leaked++;
          }
          labWorkflowsChecked++;
        }

        // Financial: every financialDetails-bearing item must have a
        // positive amount and a non-empty counterparty, and the fully
        // discovered VisibleEvidence payload must never carry a
        // suspicious/relevantToCrime-style flag.
        const session = makeSession(truth.seed, {
          evidenceStatus: Object.fromEntries(truth.evidence.map((ev) => [ev.id, "collected" as const])),
        });
        const visible = getVisibleEvidence(truth, session);
        const financial = visible.filter((ev) => ev.financialDetails);
        for (const ev of financial) {
          expect(ev.financialDetails!.amountChf).toBeGreaterThan(0);
          expect(ev.financialDetails!.counterpartyLabel.length).toBeGreaterThan(0);
          financialItemsChecked++;
        }
        const visiblePayload = JSON.stringify(visible);
        for (const forbidden of FORBIDDEN_SUBSTRINGS) {
          if (visiblePayload.includes(forbidden)) leaked++;
        }

        // CCTV: descriptor + observation/identification must respect
        // `identifiable` for every camera/dashcam item.
        const cameraEvidence = truth.evidence.filter((ev) => ev.type === "camera_footage" || ev.type === "dashcam_footage");
        for (const ev of cameraEvidence) {
          const descriptor = buildCCTVFrameDescriptor(ev, truth);
          const names = identifiedNamesForCCTV(descriptor, truth);
          if (!descriptor.identifiable && names.length > 0) leaked++;
          const observation = describeCCTVObservation(descriptor, truth);
          expect(observation.length).toBeGreaterThan(0);
          cctvItemsChecked++;
        }
      } catch {
        thrown++;
      }
    }

    console.log("=== WORKFLOW STRESS ===", { labWorkflowsChecked, financialItemsChecked, cctvItemsChecked, thrown, leaked });

    expect(thrown).toBe(0);
    expect(leaked).toBe(0);
    expect(labWorkflowsChecked).toBeGreaterThan(0);
    expect(financialItemsChecked).toBeGreaterThan(0);
    expect(cctvItemsChecked).toBeGreaterThan(0);
  });
});
