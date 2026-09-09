import { describe, expect, it } from "vitest";
import { generateCase } from "../../case-generator/case-truth";
import { computeSolvability, MIN_INDEPENDENT_CHANNELS } from "../../validator/solvability";
import { deriveWitnessCallbacks } from "../witness-callbacks";
import type { CaseTruth } from "../../types/case";

const SEEDS = ["CASE-CB0001", "CASE-CB0002", "CASE-CB0003", "CASE-CB0004", "CASE-CB0005", "CASE-CB0006", "CASE-CB0007", "CASE-CB0008"];

function generateMany(): CaseTruth[] {
  return SEEDS.map((seed) => generateCase(seed, { difficulty: "investigator" }));
}

describe("deriveWitnessCallbacks: determinism", () => {
  it("the same CaseTruth always yields the identical callback list", () => {
    const truth = generateCase("CASE-CB0001", { difficulty: "investigator" });
    const a = deriveWitnessCallbacks(truth);
    const b = deriveWitnessCallbacks(truth);
    expect(a).toEqual(b);
  });

  it("the same seed regenerated from scratch yields the identical callback list", () => {
    const truthA = generateCase("CASE-CB0002", { difficulty: "investigator" });
    const truthB = generateCase("CASE-CB0002", { difficulty: "investigator" });
    expect(deriveWitnessCallbacks(truthA)).toEqual(deriveWitnessCallbacks(truthB));
  });
});

describe("deriveWitnessCallbacks: truth-safety and semantic consistency", () => {
  const truths = generateMany();

  it("only ever produces voluntary_disclosure or clarification — never a correction", () => {
    for (const truth of truths) {
      for (const cb of deriveWitnessCallbacks(truth)) {
        expect(["voluntary_disclosure", "clarification"]).toContain(cb.kind);
      }
    }
  });

  it("never selects the culprit as a callback source", () => {
    for (const truth of truths) {
      const callbacks = deriveWitnessCallbacks(truth);
      for (const cb of callbacks) {
        expect(cb.personId).not.toBe(truth.culpritId);
      }
    }
  });

  it("every callback's content is copied verbatim from an existing KnowledgeFact — never freshly authored", () => {
    for (const truth of truths) {
      const factsById = new Map(truth.knowledge.map((f) => [f.id, f]));
      for (const cb of deriveWitnessCallbacks(truth)) {
        const fact = factsById.get(cb.factId);
        expect(fact).toBeDefined();
        expect(fact!.personId).toBe(cb.personId);
        expect(cb.content).toBe(fact!.believedStatement);
      }
    }
  });

  it("every callback references a TestimonyLine whose original stance matches its kind", () => {
    for (const truth of truths) {
      const testimonyById = new Map(truth.testimony.map((t) => [t.id, t]));
      for (const cb of deriveWitnessCallbacks(truth)) {
        const line = testimonyById.get(cb.testimonyLineId);
        expect(line).toBeDefined();
        expect(line!.personId).toBe(cb.personId);
        if (cb.kind === "voluntary_disclosure") expect(line!.stance).toBe("omission");
        if (cb.kind === "clarification") expect(line!.stance).toBe("vague");
      }
    }
  });

  it("a witness cannot remember something never perceived: the referenced fact's event must include them as present or actor", () => {
    for (const truth of truths) {
      const eventsById = new Map(truth.timeline.map((e) => [e.id, e]));
      const factsById = new Map(truth.knowledge.map((f) => [f.id, f]));
      for (const cb of deriveWitnessCallbacks(truth)) {
        const fact = factsById.get(cb.factId)!;
        const event = eventsById.get(fact.aboutEventId);
        expect(event).toBeDefined();
        if (fact.source.kind === "direct_observation") {
          const present = event!.actorId === fact.personId || event!.presentPersonIds.includes(fact.personId);
          expect(present).toBe(true);
        }
      }
    }
  });

  it("never selects more than one callback for the same witness", () => {
    for (const truth of truths) {
      const callbacks = deriveWitnessCallbacks(truth);
      const personIds = callbacks.map((c) => c.personId);
      expect(new Set(personIds).size).toBe(personIds.length);
    }
  });

  it("delay is always within the [90, 240] game-minute range", () => {
    for (const truth of truths) {
      for (const cb of deriveWitnessCallbacks(truth)) {
        expect(cb.delayMinutes).toBeGreaterThanOrEqual(90);
        expect(cb.delayMinutes).toBeLessThanOrEqual(240);
      }
    }
  });

  it("callbacks are uncommon: across many cases, most have 0-1, none exceed 3", () => {
    const counts = truths.map((truth) => deriveWitnessCallbacks(truth).length);
    for (const count of counts) {
      expect(count).toBeGreaterThanOrEqual(0);
      expect(count).toBeLessThanOrEqual(3);
    }
    const zeroOrOne = counts.filter((c) => c <= 1).length;
    expect(zeroOrOne / counts.length).toBeGreaterThanOrEqual(0.5);
  });

  it("a witness with no eligible testimony (no omission/vague fact) never gets a callback", () => {
    for (const truth of truths) {
      const testimonyByFactId = new Map(truth.testimony.map((t) => [t.aboutFactId, t]));
      const eligiblePersonIds = new Set(
        truth.knowledge
          .filter((f) => f.personId !== truth.culpritId)
          .filter((f) => {
            const t = testimonyByFactId.get(f.id);
            if (!t) return false;
            return t.stance === "omission" || t.stance === "vague";
          })
          .map((f) => f.personId),
      );
      for (const cb of deriveWitnessCallbacks(truth)) {
        expect(eligiblePersonIds.has(cb.personId)).toBe(true);
      }
    }
  });
});

describe("deriveWitnessCallbacks: epistemic safety (no CaseTruth omniscience leaks)", () => {
  const truths = generateMany();

  it("callback content never gives a witness knowledge outside their own KnowledgeFact.believedStatement", () => {
    for (const truth of truths) {
      const factsById = new Map(truth.knowledge.map((f) => [f.id, f]));
      for (const cb of deriveWitnessCallbacks(truth)) {
        const fact = factsById.get(cb.factId)!;
        expect(cb.content).toBe(fact.believedStatement);
      }
    }
  });

  it("an isCorrupted fact can never silently expose trueStatement through a callback", () => {
    for (const truth of truths) {
      const factsById = new Map(truth.knowledge.map((f) => [f.id, f]));
      for (const cb of deriveWitnessCallbacks(truth)) {
        const fact = factsById.get(cb.factId)!;
        if (fact.isCorrupted && fact.trueStatement !== fact.believedStatement) {
          expect(cb.content).not.toBe(fact.trueStatement);
        }
      }
    }
  });

  it("a witness cannot become more accurate merely because CaseTruth holds the correct answer: mutating trueStatement never changes callback content", () => {
    for (const truth of truths) {
      const callbacksBefore = deriveWitnessCallbacks(truth);
      // Corrupt every fact's trueStatement in place (simulating "what if
      // CaseTruth's ground truth were different, or more/less omniscient") —
      // the callback engine must be provably blind to this field.
      const originalTrueStatements = truth.knowledge.map((f) => f.trueStatement);
      for (const fact of truth.knowledge) fact.trueStatement = `MUTATED::${fact.trueStatement}`;
      const callbacksAfter = deriveWitnessCallbacks(truth);
      expect(callbacksAfter).toEqual(callbacksBefore);
      // restore, since `truth` objects are reused across assertions in this file
      truth.knowledge.forEach((fact, i) => {
        fact.trueStatement = originalTrueStatements[i];
      });
    }
  });

  it("deliberate lies remain untouched: no callback is ever sourced from a stance: \"lie\" TestimonyLine", () => {
    for (const truth of truths) {
      const testimonyById = new Map(truth.testimony.map((t) => [t.id, t]));
      for (const cb of deriveWitnessCallbacks(truth)) {
        const line = testimonyById.get(cb.testimonyLineId)!;
        expect(line.stance).not.toBe("lie");
      }
    }
  });

  it("omission/vague callbacks preserve the witness's own epistemic state, including when that state is itself corrupted", () => {
    for (const truth of truths) {
      const factsById = new Map(truth.knowledge.map((f) => [f.id, f]));
      for (const cb of deriveWitnessCallbacks(truth)) {
        const fact = factsById.get(cb.factId)!;
        // The callback reports exactly what this person believes right now —
        // whether or not that belief happens to be corrupted — never a
        // ground-truth-corrected version of it.
        expect(cb.content).toBe(fact.believedStatement);
      }
    }
  });
});

describe("deriveWitnessCallbacks: eligibility scope", () => {
  it("candidates can come from any non-culprit person who has a knowledge fact — witnesses and non-culprit suspects/accomplices alike, never bystanders (who have none)", () => {
    for (const truth of generateMany()) {
      const knownPersonIds = new Set(truth.knowledge.map((f) => f.personId));
      for (const cb of deriveWitnessCallbacks(truth)) {
        expect(cb.personId).not.toBe(truth.culpritId);
        expect(knownPersonIds.has(cb.personId)).toBe(true);
      }
    }
  });
});

describe("deriveWitnessCallbacks: solvability isolation", () => {
  it("does not affect computeSolvability's channel count either way", () => {
    for (const truth of generateMany()) {
      const before = computeSolvability(truth);
      deriveWitnessCallbacks(truth);
      const after = computeSolvability(truth);
      expect(after).toEqual(before);
    }
  });

  it("solvability is reached (or not) using only pre-existing channels — deriving witness callbacks never adds or removes a channel", () => {
    // Rare procedural dead ends where a generated case falls short of
    // MIN_INDEPENDENT_CHANNELS are a known, low-frequency generator
    // characteristic (see `batch.test.ts`), unrelated to this feature —
    // what this test guards is narrower: that channel count is entirely
    // insensitive to whether `deriveWitnessCallbacks` ran at all.
    for (const truth of generateMany()) {
      const channelsBefore = computeSolvability(truth).independentChannels.length;
      deriveWitnessCallbacks(truth);
      const channelsAfter = computeSolvability(truth).independentChannels.length;
      expect(channelsAfter).toBe(channelsBefore);
    }
    expect(MIN_INDEPENDENT_CHANNELS).toBe(3);
  });
});
