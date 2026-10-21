import { describe, expect, it } from "vitest";
import { generateCase } from "@/lib/game-engine/case-generator/case-truth";
import { deriveConfrontationOpportunities } from "@/lib/game-engine/witness/confrontations";
import type { CaseTruth } from "@/lib/game-engine/types/case";
import { performConfrontation } from "../confrontations";
import { computeHintOpportunities, describeAccusationReadiness, getNextHint, normalizeHintState } from "../hints";
import type { GameSession } from "../types";

function makeSession(seed: string, overrides: Partial<GameSession> = {}): GameSession {
  return {
    id: "s1",
    sessionUuid: "s1-uuid",
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

function containsWord(haystack: string, word: string): boolean {
  if (word.length === 0) return false;
  const letters = "a-zà-öø-ÿ";
  const pattern = new RegExp(`(^|[^${letters}])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^${letters}]|$)`, "i");
  return pattern.test(haystack);
}

/** A generated case in which someone's statement is a provable lie against a piece of evidence — the only
 * shape that yields a real "Confronter". Found by scanning seeds, so the tests do not depend on a lucky one. */
function caseWithAlibiConflict(): { truth: CaseTruth; op: ReturnType<typeof deriveConfrontationOpportunities>[number] } {
  for (let i = 0; i < 200; i++) {
    const truth = generateCase(`CASE-HINT-CONTRA-${i}`, { difficulty: "investigator" });
    const op = deriveConfrontationOpportunities(truth).find((o) => o.relationKind === "alibi_conflict");
    if (op) return { truth, op };
  }
  throw new Error("no generated case has an alibi conflict in 200 seeds");
}

function nameOf(truth: CaseTruth, personId: string) {
  const p = truth.people.find((x) => x.id === personId)!;
  return { first: p.firstName, last: p.lastName, full: `${p.firstName} ${p.lastName}` };
}

describe("hints — contradictions", () => {
  it("offers a confrontation hint once a statement has been taken and the contradicting evidence is in hand", () => {
    const { truth, op } = caseWithAlibiConflict();
    const session = makeSession(truth.seed, {
      interrogated: { [op.personId]: [op.factId] },
      evidenceStatus: { [op.evidenceId]: "analyzed" },
    });
    const opp = computeHintOpportunities(truth, session).find((o) => o.id === "contradiction-confront");
    expect(opp).toBeDefined();
    expect(opp!.category).toBe("contradiction");
    const who = nameOf(truth, op.personId);
    // Level 1 and 2 never name anyone; level 3 names the person the "Confronter" button is already on.
    expect(containsWord(opp!.levels[0], who.last)).toBe(false);
    expect(containsWord(opp!.levels[1], who.last)).toBe(false);
    expect(opp!.levels[2]).toContain(who.full);
    expect(opp!.levels[2]).toContain("Confrontez");
  });

  it("drops the confrontation hint once the confrontation has been performed", () => {
    const { truth, op } = caseWithAlibiConflict();
    const session = makeSession(truth.seed, {
      interrogated: { [op.personId]: [op.factId] },
      evidenceStatus: { [op.evidenceId]: "analyzed" },
    });
    expect(computeHintOpportunities(truth, session).some((o) => o.id === "contradiction-confront")).toBe(true);
    const performed = performConfrontation(truth, session, op.personId, op.id);
    expect(performed).not.toBeNull();
    expect(computeHintOpportunities(truth, session).some((o) => o.id === "contradiction-confront")).toBe(false);
  });

  it("never offers a contradiction hint before the evidence behind it has been found", () => {
    for (let i = 0; i < 40; i++) {
      const truth = generateCase(`CASE-HINT-CONTRA-EARLY-${i}`, { difficulty: "investigator" });
      const session = makeSession(truth.seed);
      const ids = computeHintOpportunities(truth, session).map((o) => o.id);
      expect(ids).not.toContain("contradiction-confront");
      expect(ids).not.toContain("contradiction-question");
      expect(ids).not.toContain("followup-pressure");
    }
  });

  it("asks the player to question someone whose alibi the file already contradicts, then hands over to the confrontation", () => {
    const { truth, op } = caseWithAlibiConflict();
    const found = makeSession(truth.seed, { evidenceStatus: { [op.evidenceId]: "analyzed" } });
    const question = computeHintOpportunities(truth, found).find((o) => o.id === "contradiction-question");
    expect(question).toBeDefined();
    expect(question!.levels[2]).toContain(nameOf(truth, op.personId).full);
    expect(computeHintOpportunities(truth, found).some((o) => o.id === "contradiction-confront")).toBe(false);

    // Once the statement has been taken, the question is answered and the confrontation takes over.
    const asked = makeSession(truth.seed, {
      interrogated: { [op.personId]: [op.factId] },
      evidenceStatus: { [op.evidenceId]: "analyzed" },
    });
    const ids = computeHintOpportunities(truth, asked).map((o) => o.id);
    expect(ids).not.toContain("contradiction-question");
    expect(ids).toContain("contradiction-confront");
  });

  it("flags an unverified alibi, and stops once something supports or contradicts it", () => {
    let checked = 0;
    for (let i = 0; i < 40 && checked < 5; i++) {
      const truth = generateCase(`CASE-HINT-ALIBI-${i}`, { difficulty: "investigator" });
      const fresh = makeSession(truth.seed);
      const opp = computeHintOpportunities(truth, fresh).find((o) => o.id === "alibi-unverified");
      if (!opp) continue;
      checked += 1;
      expect(opp.category).toBe("alibi");
      // Show every piece of alibi evidence in the case: nothing is left to verify.
      const evidenceIds = truth.alibis.flatMap((a) => [...a.corroboratingEvidenceIds, ...a.contradictingEvidenceIds]);
      const done = makeSession(truth.seed, { evidenceStatus: Object.fromEntries(evidenceIds.map((id) => [id, "collected" as const])) });
      expect(computeHintOpportunities(truth, done).some((o) => o.id === "alibi-unverified")).toBe(false);
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("contradiction and alibi hints never state a verdict or name the motive, at any level", () => {
    const SPOILERS = ["est le coupable", "est coupable", "a tué", "est l'assassin", "le mobile est", "le mobile était", "menteur", "a menti"];
    const MOTIVE_WORDS = ["jalousie", "vengeance", "argent", "héritage", "dette", "conflit professionnel", "fraude", "rivalité"];
    const { truth, op } = caseWithAlibiConflict();
    const states = [
      makeSession(truth.seed),
      makeSession(truth.seed, { evidenceStatus: { [op.evidenceId]: "analyzed" } }),
      makeSession(truth.seed, { interrogated: { [op.personId]: [op.factId] }, evidenceStatus: { [op.evidenceId]: "analyzed" } }),
    ];
    for (const session of states) {
      for (const opp of computeHintOpportunities(truth, session)) {
        if (!["contradiction", "alibi", "accusation"].includes(opp.category)) continue;
        for (const [i, text] of opp.levels.entries()) {
          const t = text.toLowerCase();
          for (const phrase of SPOILERS) expect(t, `${opp.id} L${i + 1}`).not.toContain(phrase);
          expect(containsWord(t, "ment"), `${opp.id} L${i + 1} must not say someone lies`).toBe(false);
          if (i === 0) for (const word of MOTIVE_WORDS) expect(t, `${opp.id} L1`).not.toContain(word);
        }
      }
    }
  });
});

describe("hints — is it time to accuse?", () => {
  it("reads 'early' with three or more essential avenues open, 'near' with one or two, 'ready' with none", () => {
    const three = describeAccusationReadiness(["crime-scene-examine", "interrogation-unresolved", "timeline-gap"], 4)!;
    expect(three.readiness).toBe("early");
    expect(three.levels[1]).toContain("la scène de crime");
    expect(three.levels[2]).toContain("Commencez par");

    const two = describeAccusationReadiness(["interrogation-unresolved", "timeline-gap"], 0)!;
    expect(two.readiness).toBe("near");
    expect(describeAccusationReadiness(["timeline-gap"], 2)!.readiness).toBe("near");

    const none = describeAccusationReadiness([], 3)!;
    expect(none.readiness).toBe("ready");
    expect(none.levels[0]).toContain("vous pouvez envisager d'accuser");
  });

  it("returns nothing when no avenue at all is left, so the terminal message keeps that state", () => {
    expect(describeAccusationReadiness([], 0)).toBeNull();
  });

  it("is a real, low-priority opportunity from the very start, and never the top suggestion", () => {
    for (let i = 0; i < 20; i++) {
      const truth = generateCase(`CASE-HINT-TIMING-${i}`, { difficulty: "investigator" });
      const opportunities = computeHintOpportunities(truth, makeSession(truth.seed));
      const timing = opportunities.find((o) => o.id === "accusation-timing");
      expect(timing).toBeDefined();
      expect(timing!.category).toBe("accusation");
      expect(opportunities[0].id).not.toBe("accusation-timing");
      expect(timing!.levels[0]).toMatch(/tôt|approchez|exploitées/);
    }
  });

  it("depends on how far the groundwork has come, never on who did it: its text never names anyone or the motive", () => {
    const MOTIVE_WORDS = ["jalousie", "vengeance", "argent", "héritage", "dette", "conflit professionnel", "fraude", "rivalité"];
    for (let i = 0; i < 25; i++) {
      const truth = generateCase(`CASE-HINT-TIMING-SAFE-${i}`, { difficulty: "investigator" });
      const timing = computeHintOpportunities(truth, makeSession(truth.seed)).find((o) => o.id === "accusation-timing")!;
      for (const text of timing.levels) {
        for (const p of truth.people) {
          expect(containsWord(text, p.lastName)).toBe(false);
        }
        for (const word of MOTIVE_WORDS) expect(text.toLowerCase()).not.toContain(word);
      }
    }
  });

  it("two cases in the same state of progress get the same accusation advice, whatever the culprit", () => {
    const a = generateCase("CASE-HINT-SAME-A", { difficulty: "investigator" });
    const b = generateCase("CASE-HINT-SAME-B", { difficulty: "investigator" });
    expect(a.culpritId).not.toBe(b.culpritId);
    const open = ["crime-scene-examine", "interrogation-unresolved", "timeline-gap"];
    expect(describeAccusationReadiness(open, 2)).toEqual(describeAccusationReadiness(open, 2));
    // The advice is a function of open avenues alone: it has no access to either case.
    expect(describeAccusationReadiness.length).toBe(2);
  });

  it("reaches the player through the normal request, in priority order after the more concrete leads", () => {
    const truth = generateCase("CASE-HINT-TIMING-FLOW", { difficulty: "investigator" });
    const session = makeSession(truth.seed);
    const total = computeHintOpportunities(truth, session).length;
    const seen: string[] = [];
    for (let i = 0; i < total; i++) seen.push(getNextHint(truth, session).hintId);
    expect(seen).toContain("accusation-timing");
    expect(seen.indexOf("accusation-timing")).toBe(seen.length - 1);
    expect(new Set(seen).size).toBe(seen.length);
  });
});

describe("hints — persistence of the new categories", () => {
  it("accepts contradiction, alibi and accusation history entries when a session is reloaded", () => {
    const state = normalizeHintState({
      progress: { "contradiction-confront": 2, "alibi-unverified": 1, "accusation-timing": 3 },
      history: [
        { hintId: "contradiction-confront", category: "contradiction", level: 2, text: "a", requestedAt: 5 },
        { hintId: "alibi-unverified", category: "alibi", level: 1, text: "b", requestedAt: 6 },
        { hintId: "accusation-timing", category: "accusation", level: 3, text: "c", requestedAt: 7 },
        { hintId: "x", category: "not-a-category", level: 1, text: "d", requestedAt: 8 },
      ],
      totalHintsUsed: 3,
    });
    expect(state.history.map((h) => h.category)).toEqual(["contradiction", "alibi", "accusation"]);
    expect(state.progress["accusation-timing"]).toBe(3);
  });
});
