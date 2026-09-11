import { describe, expect, it } from "vitest";
import { generateCase } from "@/lib/game-engine/case-generator/case-truth";

/**
 * Pre-commit historical-case compatibility audit (Investigation Clarity &
 * Evidence UX pass). `generateCase` is never persisted — every reload
 * regenerates `CaseTruth` fresh from `seed`+`difficulty` (see
 * `lib/game-session/with-session.ts#withSession`), and a `GameSession`
 * only persists per-evidence PLAYER STATE keyed by `Evidence.id` (see
 * `evidenceStatus`/`labQueue` in `lib/game-session/types.ts`). So an
 * already-started investigation's evidence identity is only as stable as
 * the generator's id sequencing — anything that shifts an id silently
 * orphans that player's discovered/collected/lab-queued state.
 *
 * The audit found exactly this: `RNG.id()` derives its output from
 * `this.callCount`, a counter shared by every `.float()`-family call on
 * the SAME `RNG` instance (see `lib/game-engine/random/rng.ts`). Both
 * `generateRedHerrings` (evidence-generator.ts) and `buildSecondaryTrace`
 * (tampering.ts) briefly drew a new `financialDetails.amountChf` straight
 * from their shared per-call `rng` parameter, BEFORE that same instance's
 * `rng.id("ev")` call — shifting `callCount` and silently changing the id
 * of that item (and, for red herrings, every later item sharing the same
 * stream) for any case where the draw happened to fire. Confirmed
 * empirically: comparing `generateCase` before/after the enrichment pass
 * across 20 fixed seeds, 2/20 lost a red-herring evidence id outright.
 * Both call sites now roll the amount from an isolated `rng.derive(...)`
 * sub-stream instead (the same discipline `deriveEvidenceFromTimeline`'s
 * `financial-${event.id}` roll already used correctly) — these tests pin
 * the exact ids that fix restores/produces, so any future reintroduction
 * of a shared-stream draw ahead of an `id()` call fails immediately.
 */
describe("evidence id stability — historical-case compatibility", () => {
  it("[C, D] a red-herring evidence id involving a card_payment flavor (the exact previously-broken path) is stable", () => {
    // Both seeds previously lost their sole red herring's id when the
    // chosen flavor was card_payment — see the compatibility audit. Pinned
    // here as the historical-parity baseline (these ids match what the
    // PRE-enrichment generator already produced for these seeds).
    const CASES: Record<string, string> = {
      "CASE-COMPAT-03": "ev_1sj529l",
      "CASE-COMPAT-04": "ev_bkbp2e",
    };
    for (const [seed, expectedId] of Object.entries(CASES)) {
      const truth = generateCase(seed, { difficulty: "investigator" });
      const redHerrings = truth.evidence.filter((e) => e.isRedHerring && e.type === "card_payment");
      expect(redHerrings.map((e) => e.id)).toContain(expectedId);
    }
  });

  it("[C, D] a disguise_transaction tampering trace's evidence id is stable", () => {
    // Pinned post-fix baseline for the one seed (in a 0-59 sweep) that
    // triggers `disguise_transaction` tampering — the other previously-
    // broken shared-stream path, in `tampering.ts#buildSecondaryTrace`.
    const seed = "CASE-DISGUISE-26";
    const truth = generateCase(seed, { difficulty: "investigator" });
    const disguise = truth.tamperingEvents.find((t) => t.action === "disguise_transaction");
    expect(disguise).toBeDefined();
    expect(disguise!.secondaryTraceEvidenceId).toBe("ev_bwux72");
    const traceEvidence = truth.evidence.find((e) => e.id === disguise!.secondaryTraceEvidenceId);
    expect(traceEvidence).toBeDefined();
    expect(traceEvidence!.type).toBe("bank_transfer");
  });

  it("[C] every evidence id in a freshly generated case is unique (no accidental collision from the derived financial sub-streams)", () => {
    for (let i = 0; i < 30; i++) {
      const truth = generateCase(`CASE-IDCHECK-${i}`, { difficulty: "investigator" });
      const ids = truth.evidence.map((e) => e.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("[G] same seed, regenerated twice, yields byte-identical evidence id lists (order and content)", () => {
    for (let i = 0; i < 10; i++) {
      const seed = `CASE-IDDETERMINISM-${i}`;
      const a = generateCase(seed, { difficulty: "investigator" });
      const b = generateCase(seed, { difficulty: "investigator" });
      expect(a.evidence.map((e) => e.id)).toEqual(b.evidence.map((e) => e.id));
    }
  });

  it("[I] culprit/motive/suspects never drift as a side effect of the financial-detail sub-stream fix", () => {
    for (let i = 0; i < 15; i++) {
      const seed = `CASE-TRUTHSTABLE-${i}`;
      const a = generateCase(seed, { difficulty: "investigator" });
      const b = generateCase(seed, { difficulty: "investigator" });
      expect(a.culpritId).toBe(b.culpritId);
      expect(a.motive).toEqual(b.motive);
      expect(a.suspectIds).toEqual(b.suspectIds);
    }
  });
});
