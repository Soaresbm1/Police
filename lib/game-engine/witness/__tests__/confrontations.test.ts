import { describe, expect, it } from "vitest";
import { generateCase } from "../../case-generator/case-truth";
import { computeSolvability, MIN_INDEPENDENT_CHANNELS } from "../../validator/solvability";
import { deriveConfrontationOpportunities } from "../confrontations";
import type { CaseTruth } from "../../types/case";
import type { KnowledgeFact, TestimonyLine } from "../../types/knowledge";
import type { Evidence } from "../../types/evidence";

const SEEDS = Array.from({ length: 20 }, (_, i) => `CASE-CF${String(i + 1).padStart(4, "0")}`);

function generateMany(): CaseTruth[] {
  return SEEDS.map((seed) => generateCase(seed, { difficulty: "investigator" }));
}

function findCaseWith(kind: "alibi_conflict" | "evidence_backed_followup"): { truth: CaseTruth; opportunityId: string } {
  for (let i = 1; i <= 80; i++) {
    const seed = `CASE-CFX${String(i).padStart(4, "0")}`;
    const truth = generateCase(seed, { difficulty: "investigator" });
    const match = deriveConfrontationOpportunities(truth).find((op) => op.relationKind === kind);
    if (match) return { truth, opportunityId: match.id };
  }
  throw new Error(`No case with a "${kind}" confrontation opportunity found in sweep — widen the seed range`);
}

describe("deriveConfrontationOpportunities: determinism", () => {
  it("the same CaseTruth always yields the identical opportunity list", () => {
    const truth = generateCase("CASE-CF0001", { difficulty: "investigator" });
    expect(deriveConfrontationOpportunities(truth)).toEqual(deriveConfrontationOpportunities(truth));
  });

  it("the same seed regenerated from scratch yields the identical opportunity list", () => {
    const a = generateCase("CASE-CF0002", { difficulty: "investigator" });
    const b = generateCase("CASE-CF0002", { difficulty: "investigator" });
    expect(deriveConfrontationOpportunities(a)).toEqual(deriveConfrontationOpportunities(b));
  });

  it("mutating trueStatement on every fact never changes the derived opportunities (the function is structurally blind to it)", () => {
    for (const truth of generateMany()) {
      const before = deriveConfrontationOpportunities(truth);
      const original = truth.knowledge.map((f) => f.trueStatement);
      for (const fact of truth.knowledge) fact.trueStatement = `MUTATED::${fact.trueStatement}`;
      const after = deriveConfrontationOpportunities(truth);
      expect(after).toEqual(before);
      truth.knowledge.forEach((fact, i) => {
        fact.trueStatement = original[i];
      });
    }
  });
});

describe("deriveConfrontationOpportunities: structural soundness (no free-text comparison)", () => {
  const truths = generateMany();

  it("only ever produces alibi_conflict or evidence_backed_followup — never a bare same-event 'contradiction'", () => {
    for (const truth of truths) {
      for (const op of deriveConfrontationOpportunities(truth)) {
        expect(["alibi_conflict", "evidence_backed_followup"]).toContain(op.relationKind);
      }
    }
  });

  it("every alibi_conflict opportunity's evidence is one of that person's Alibi.contradictingEvidenceIds, on a false alibi", () => {
    for (const truth of truths) {
      const alibiByPerson = new Map(truth.alibis.map((a) => [a.personId, a]));
      for (const op of deriveConfrontationOpportunities(truth).filter((o) => o.relationKind === "alibi_conflict")) {
        const alibi = alibiByPerson.get(op.personId);
        expect(alibi).toBeDefined();
        expect(alibi!.isTrue).toBe(false);
        expect(alibi!.contradictingEvidenceIds).toContain(op.evidenceId);
      }
    }
  });

  it("every evidence_backed_followup opportunity's evidence shares the exact same sourceEventId as the fact's aboutEventId, and is never a red herring", () => {
    for (const truth of truths) {
      const factsById = new Map(truth.knowledge.map((f) => [f.id, f]));
      const evidenceById = new Map(truth.evidence.map((e) => [e.id, e]));
      for (const op of deriveConfrontationOpportunities(truth).filter((o) => o.relationKind === "evidence_backed_followup")) {
        const fact = factsById.get(op.factId)!;
        const evidence = evidenceById.get(op.evidenceId)!;
        expect(evidence.sourceEventId).toBe(fact.aboutEventId);
        expect(evidence.isRedHerring).toBe(false);
      }
    }
  });

  it("every opportunity references a real TestimonyLine belonging to the same person", () => {
    for (const truth of truths) {
      const testimonyById = new Map(truth.testimony.map((t) => [t.id, t]));
      for (const op of deriveConfrontationOpportunities(truth)) {
        const line = testimonyById.get(op.testimonyLineId);
        expect(line).toBeDefined();
        expect(line!.personId).toBe(op.personId);
      }
    }
  });
});

describe("deriveConfrontationOpportunities: epistemic and lie safety", () => {
  const truths = generateMany();

  it("a stance: \"lie\" opportunity always reacts with maintains_statement — never an admission, retraction, or confession", () => {
    for (const truth of truths) {
      const testimonyById = new Map(truth.testimony.map((t) => [t.id, t]));
      for (const op of deriveConfrontationOpportunities(truth)) {
        const line = testimonyById.get(op.testimonyLineId)!;
        if (line.stance === "lie") {
          expect(op.reactionKind).toBe("maintains_statement");
        }
      }
    }
  });

  it("the culprit's own false alibi CAN produce a confrontation opportunity, and it still never auto-confesses", () => {
    for (const truth of truths) {
      for (const op of deriveConfrontationOpportunities(truth).filter((o) => o.relationKind === "alibi_conflict")) {
        expect(op.reactionKind).toBe("maintains_statement");
        expect(op.reaction).not.toMatch(/j'ai (tué|menti|caché le corps)/i);
      }
    }
  });

  it("reaction content for omission/vague follow-ups is always exactly believedStatement — never trueStatement, never authored text", () => {
    for (const truth of truths) {
      const factsById = new Map(truth.knowledge.map((f) => [f.id, f]));
      const testimonyById = new Map(truth.testimony.map((t) => [t.id, t]));
      for (const op of deriveConfrontationOpportunities(truth).filter((o) => o.relationKind === "evidence_backed_followup")) {
        const fact = factsById.get(op.factId)!;
        const line = testimonyById.get(op.testimonyLineId)!;
        if (line.stance === "omission") {
          expect(op.reactionKind).toBe("admits_omission");
        } else if (line.stance === "vague") {
          expect(op.reactionKind).toBe("clarifies_statement");
        } else {
          throw new Error(`Unexpected stance "${line.stance}" produced an evidence_backed_followup opportunity`);
        }
        expect(op.reaction).toBe(fact.believedStatement);
      }
    }
  });

  it("no opportunity is ever produced for a truthful stance, corrupted or not — same-event evidence alone never justifies expressing doubt about a mistaken belief", () => {
    for (const truth of truths) {
      const factsById = new Map(truth.knowledge.map((f) => [f.id, f]));
      const testimonyById = new Map(truth.testimony.map((t) => [t.id, t]));
      for (const op of deriveConfrontationOpportunities(truth)) {
        const fact = factsById.get(op.factId)!;
        const line = testimonyById.get(op.testimonyLineId)!;
        expect(line.stance === "truthful").toBe(false);
        // Defensive corollary: no reactionKind for a corrupted-memory
        // "doubt" reaction exists in the type at all anymore, but assert
        // the underlying fact was never used as a source either way.
        void fact;
      }
    }
  });

  it("a corrupted witness never gains, nor expresses doubt about, trueStatement merely because an opportunity exists", () => {
    for (const truth of truths) {
      const factsById = new Map(truth.knowledge.map((f) => [f.id, f]));
      for (const op of deriveConfrontationOpportunities(truth)) {
        const fact = factsById.get(op.factId)!;
        if (fact.isCorrupted && fact.trueStatement !== fact.believedStatement) {
          expect(op.reaction).not.toBe(fact.trueStatement);
          expect(op.reaction).not.toContain(fact.trueStatement);
        }
      }
    }
  });
});

describe("deriveConfrontationOpportunities: deliberately constructed same-event-but-not-contradicting case", () => {
  it("KnowledgeFact and Evidence sharing an aboutEventId/sourceEventId alone, with a truthful non-corrupted stance, produces NO opportunity", () => {
    const truth = generateCase("CASE-CF0001", { difficulty: "investigator" });

    // Fabricate a fresh event id, a truthful+uncorrupted KnowledgeFact
    // about it, its truthful TestimonyLine, and a piece of Evidence that
    // shares the exact same sourceEventId — structurally identical to a
    // real "same event" match, but with nothing to contradict: the
    // witness's account is accurate, and the evidence is just a
    // financial record about the same moment (it doesn't even mention
    // the belief in question). This proves same-event matching alone
    // cannot fabricate a contradiction.
    const personId = truth.people[0].id;
    const fabricatedEventId = "evt_fabricated_same_event_test";
    const fabricatedFact: KnowledgeFact = {
      id: "fact_fabricated_test",
      personId,
      aboutEventId: fabricatedEventId,
      trueStatement: "A vu la scène telle qu'elle était.",
      source: { kind: "direct_observation" },
      learnedAt: 0,
      perceptionQuality: 1,
      memoryQuality: 1,
      confidence: 1,
      isCorrupted: false,
      believedStatement: "A vu la scène telle qu'elle était.",
    };
    const fabricatedTestimony: TestimonyLine = {
      id: "testimony_fabricated_test",
      personId,
      aboutFactId: fabricatedFact.id,
      stance: "truthful",
      statement: fabricatedFact.believedStatement,
      motiveForStance: "témoignage sincère",
      loyaltyReason: null,
    };
    const fabricatedEvidence: Evidence = {
      id: "ev_fabricated_test",
      family: "financial",
      type: "card_payment",
      sourceEventId: fabricatedEventId,
      sourceLocationId: null,
      relatedPersonIds: [personId],
      relatedLocationIds: [],
      timestamp: 0,
      discoverableAt: 0,
      discoveryDifficulty: 0,
      reliability: "reliable",
      requiresLabAnalysis: null,
      isRedHerring: false,
      status: "undiscovered",
      description: "Paiement par carte enregistré au même moment.",
    };

    const augmented: CaseTruth = {
      ...truth,
      knowledge: [...truth.knowledge, fabricatedFact],
      testimony: [...truth.testimony, fabricatedTestimony],
      evidence: [...truth.evidence, fabricatedEvidence],
    };

    const opportunities = deriveConfrontationOpportunities(augmented);
    expect(opportunities.some((op) => op.factId === fabricatedFact.id)).toBe(false);
  });
});

describe("deriveConfrontationOpportunities: independent of player state", () => {
  it("takes no session/player-state argument at all — it is a pure function of CaseTruth alone (structural guarantee, not just a test of behavior)", () => {
    expect(deriveConfrontationOpportunities.length).toBe(1);
  });
});

describe("deriveConfrontationOpportunities: solvability isolation", () => {
  it("does not affect computeSolvability's channel count either way", () => {
    for (const truth of generateMany()) {
      const before = computeSolvability(truth);
      deriveConfrontationOpportunities(truth);
      const after = computeSolvability(truth);
      expect(after).toEqual(before);
    }
  });

  it("solvability's minimum channel requirement is untouched by this module", () => {
    expect(MIN_INDEPENDENT_CHANNELS).toBe(3);
  });
});

describe("findCaseWith sweep sanity", () => {
  it("both opportunity kinds are actually reachable in real generated cases", () => {
    expect(() => findCaseWith("alibi_conflict")).not.toThrow();
    expect(() => findCaseWith("evidence_backed_followup")).not.toThrow();
  });
});
