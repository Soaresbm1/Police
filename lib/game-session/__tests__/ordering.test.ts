import { describe, expect, it } from "vitest";
import { generateCase } from "@/lib/game-engine/case-generator/case-truth";
import { getSuspects, getWitnesses } from "../player-view";
import { ACCUSATION_PERSON_ORDER_DOMAIN, guiltBlindOrderKey, orderPeopleGuiltBlind, SUSPECT_LIST_ORDER_DOMAIN } from "../ordering";

describe("guiltBlindOrderKey", () => {
  it("is a pure function of caseSeed+domain+personId — same inputs always give the same key", () => {
    const a = guiltBlindOrderKey("CASE-1", "suspect-list-order", "p1");
    const b = guiltBlindOrderKey("CASE-1", "suspect-list-order", "p1");
    expect(a).toBe(b);
  });

  it("varies with domain, holding caseSeed+personId fixed", () => {
    const keys = new Set(
      ["suspect-list-order", "accusation-person-order", "witness-list-order"].map((d) => guiltBlindOrderKey("CASE-1", d, "p1")),
    );
    expect(keys.size).toBeGreaterThan(1);
  });

  it("varies with personId, holding caseSeed+domain fixed", () => {
    const keys = new Set(["p1", "p2", "p3", "p4"].map((id) => guiltBlindOrderKey("CASE-1", "suspect-list-order", id)));
    expect(keys.size).toBe(4);
  });

  it("varies with caseSeed, holding domain+personId fixed", () => {
    const keys = new Set(["CASE-1", "CASE-2", "CASE-3"].map((seed) => guiltBlindOrderKey(seed, "suspect-list-order", "p1")));
    expect(keys.size).toBe(3);
  });
});

describe("orderPeopleGuiltBlind", () => {
  it("never mutates the input array and preserves the same set of ids", () => {
    const people = [{ id: "p3" }, { id: "p1" }, { id: "p2" }];
    const original = [...people];
    const ordered = orderPeopleGuiltBlind("CASE-1", "d", people);
    expect(people).toEqual(original);
    expect(new Set(ordered.map((p) => p.id))).toEqual(new Set(["p1", "p2", "p3"]));
  });

  it("is stable across repeated calls (refresh-stable)", () => {
    const people = [{ id: "p1" }, { id: "p2" }, { id: "p3" }, { id: "p4" }];
    const first = orderPeopleGuiltBlind("CASE-X", "suspect-list-order", people).map((p) => p.id);
    const second = orderPeopleGuiltBlind("CASE-X", "suspect-list-order", people).map((p) => p.id);
    expect(second).toEqual(first);
  });
});

describe("getSuspects — guilt-blind ordering (player-facing)", () => {
  it("never derives order from culpritId: across many cases, the culprit does not systematically land first", () => {
    const SAMPLE = 400;
    let firstCount = 0;
    let middleCount = 0;
    let lastCount = 0;
    for (let i = 0; i < SAMPLE; i++) {
      const truth = generateCase(`CASE-ORDER-${i}`, { difficulty: "investigator" });
      const suspects = getSuspects(truth);
      const idx = suspects.findIndex((s) => s.id === truth.culpritId);
      expect(idx).toBeGreaterThanOrEqual(0);
      if (idx === 0) firstCount++;
      else if (idx === suspects.length - 1) lastCount++;
      else middleCount++;
    }
    // A guilt-derived (or generation-order-derived) placement would put the
    // culprit first ~100% of the time. A guilt-blind hash order should land
    // the culprit first roughly 1/N of the time for an N-suspect case —
    // nowhere near systematic. This is a coarse sanity bound, not a
    // uniformity proof.
    expect(firstCount / SAMPLE).toBeLessThan(0.6);
    expect(middleCount + lastCount).toBeGreaterThan(0);
  });

  it("is refresh-stable: re-deriving the same case (same seed) yields the same suspect order", () => {
    const truthA = generateCase("CASE-ORDER-STABLE", { difficulty: "investigator" });
    const truthB = generateCase("CASE-ORDER-STABLE", { difficulty: "investigator" });
    expect(getSuspects(truthA).map((s) => s.id)).toEqual(getSuspects(truthB).map((s) => s.id));
  });

  it("varies with caseSeed: different cases don't all share one fixed order", () => {
    const orders = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const truth = generateCase(`CASE-ORDER-VARY-${i}`, { difficulty: "investigator" });
      orders.add(getSuspects(truth).map((s) => s.id).join(","));
    }
    expect(orders.size).toBeGreaterThan(1);
  });

  it("the suspect-list domain and the accusation domain order the same case's suspects independently", () => {
    let differed = false;
    for (let i = 0; i < 30; i++) {
      const truth = generateCase(`CASE-ORDER-DOMAIN-${i}`, { difficulty: "investigator" });
      const listOrder = getSuspects(truth, SUSPECT_LIST_ORDER_DOMAIN).map((s) => s.id);
      const accusationOrder = getSuspects(truth, ACCUSATION_PERSON_ORDER_DOMAIN).map((s) => s.id);
      if (listOrder.join(",") !== accusationOrder.join(",")) differed = true;
    }
    expect(differed).toBe(true);
  });
});

describe("getWitnesses — guilt-blind ordering", () => {
  it("is refresh-stable and contains exactly the non-victim, non-suspect people", () => {
    const truth = generateCase("CASE-ORDER-WITNESS", { difficulty: "investigator" });
    const witnessesA = getWitnesses(truth).map((w) => w.id);
    const witnessesB = getWitnesses(truth).map((w) => w.id);
    expect(witnessesA).toEqual(witnessesB);
    const expectedIds = new Set(truth.people.filter((p) => p.id !== truth.victimId && !truth.suspectIds.includes(p.id)).map((p) => p.id));
    expect(new Set(witnessesA)).toEqual(expectedIds);
  });
});
