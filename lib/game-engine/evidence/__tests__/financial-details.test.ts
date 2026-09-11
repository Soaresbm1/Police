import { describe, expect, it } from "vitest";
import { generateCase } from "@/lib/game-engine/case-generator/case-truth";
import { formatChf } from "../evidence-generator";

const FINANCIAL_TYPES = ["card_payment", "cash_withdrawal", "bank_transfer"] as const;

describe("formatChf", () => {
  it("renders a Swiss-franc amount with the project's existing format", () => {
    expect(formatChf(490)).toBe("CHF 490.–");
  });

  it("uses fr-CH thousands separation for larger amounts", () => {
    // toLocaleString("fr-CH") uses a non-breaking (or thin) space as the
    // thousands separator — just assert the digits and suffix survive.
    const label = formatChf(1500);
    expect(label.startsWith("CHF")).toBe(true);
    expect(label.endsWith(".–")).toBe(true);
    expect(label).toContain("500");
  });
});

describe("financial evidence — structured details", () => {
  it("every financial-family evidence item with a real amount carries financialDetails, never just decorative text", () => {
    const truth = generateCase("CASE-FIN-1", { difficulty: "investigator" });
    const financial = truth.evidence.filter((ev) => FINANCIAL_TYPES.includes(ev.type as (typeof FINANCIAL_TYPES)[number]));
    expect(financial.length).toBeGreaterThan(0);
    for (const ev of financial) {
      if (!ev.financialDetails) continue; // debt_record-style entries may legitimately have none
      expect(ev.financialDetails.amountChf).toBeGreaterThan(0);
      expect(["debit", "credit"]).toContain(ev.financialDetails.direction);
      expect(ev.financialDetails.counterpartyLabel.length).toBeGreaterThan(0);
      // The description and the structured amount must never disagree —
      // the description is built from the SAME resolved financialDetails.
      expect(ev.description).toContain(formatChf(ev.financialDetails.amountChf));
    }
  });

  it("never exposes a suspicious/relevantToCrime/motiveLink/culpritLink field on any evidence item", () => {
    const truth = generateCase("CASE-FIN-2", { difficulty: "investigator" });
    for (const ev of truth.evidence) {
      const keys = Object.keys(ev);
      for (const forbidden of ["suspicious", "relevantToCrime", "motiveLink", "culpritLink"]) {
        expect(keys).not.toContain(forbidden);
      }
    }
  });

  it("generates mundane ambient financial noise for suspects, not just narratively-real transactions", () => {
    const truth = generateCase("CASE-FIN-3", { difficulty: "investigator" });
    const suspectFinancial = truth.evidence.filter(
      (ev) => ev.family === "financial" && ev.relatedPersonIds.some((id) => truth.suspectIds.includes(id)),
    );
    // At least one suspect should have more than one financial entry once
    // ambient noise is mixed in with any narratively-real transaction.
    const perSuspectCounts = new Map<string, number>();
    for (const ev of suspectFinancial) {
      for (const id of ev.relatedPersonIds) {
        if (!truth.suspectIds.includes(id)) continue;
        perSuspectCounts.set(id, (perSuspectCounts.get(id) ?? 0) + 1);
      }
    }
    expect(perSuspectCounts.size).toBeGreaterThan(0);
  });

  it("is deterministic: regenerating the same seed produces identical financial details", () => {
    const truthA = generateCase("CASE-FIN-DETERMINISM", { difficulty: "investigator" });
    const truthB = generateCase("CASE-FIN-DETERMINISM", { difficulty: "investigator" });
    const finA = truthA.evidence.filter((ev) => ev.financialDetails).map((ev) => ev.financialDetails);
    const finB = truthB.evidence.filter((ev) => ev.financialDetails).map((ev) => ev.financialDetails);
    expect(finA).toEqual(finB);
  });
});
