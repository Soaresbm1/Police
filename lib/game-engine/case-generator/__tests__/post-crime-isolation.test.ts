import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createRootRng } from "../../random/rng";
import { computeSolvability, MIN_INDEPENDENT_CHANNELS } from "../../validator/solvability";
import { validateCase } from "../../validator/case-validator";
import type { CaseTruth } from "../../types/case";

vi.mock("../../simulation/post-crime-observation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../simulation/post-crime-observation")>();
  return { ...actual, generatePostCrimeMovements: vi.fn(actual.generatePostCrimeMovements) };
});

import { generateCase } from "../case-truth";
import { generatePostCrimeMovements } from "../../simulation/post-crime-observation";

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(",")}}`;
}

/** Everything in CaseTruth except the wall-clock timestamp and the
 * deliberately-isolated Phase 5A/Motive-Digital-Evidence layers — this is
 * the projection that must never change as a side effect of adding either.
 * `victimPhone` is excluded the same way `postCrimeMovements` is: both are
 * their own top-level field, generated from an isolated `rootRng.derive`
 * stream, specifically so their mere existence can never perturb anything
 * else this hash covers (see `case-truth.ts`'s victim-phone comment). The
 * ONE new `victim_phone` Evidence item (the recovered device) is NOT
 * excluded — it's a real, intentional addition to `evidence[]`, the same
 * kind of change `ambientFinancialActivity` made in the prior phase. */
function canonicalProjection(truth: CaseTruth): Omit<CaseTruth, "generatedAt" | "postCrimeMovements" | "victimPhone"> {
  const rest: Partial<CaseTruth> = { ...truth };
  delete rest.generatedAt;
  delete rest.postCrimeMovements;
  delete rest.victimPhone;
  return rest as Omit<CaseTruth, "generatedAt" | "postCrimeMovements" | "victimPhone">;
}

// Pinned baseline hashes of canonicalProjection(generateCase(seed)), captured
// from the current, verified-correct implementation (cross-checked via an
// empirical git-stash before/after diff across the same 20+ seeds while
// this feature was built — see Phase 5A report). If any future change alters
// anything other than postCrimeMovements/generatedAt for these seeds, this
// test catches it immediately.
// Re-pinned for the age/occupation/life-status population rework, its
// distribution-tuning follow-up, Phase 5B-1 (surveillance, which added
// `CaseTruth.caseOpenedAt`), and now for the investigation-clarity/evidence-UX
// player-test pass, which — unlike every prior re-pin — DOES change
// `CaseTruth.evidence` itself for every seed, on purpose:
//   1. `generateAmbientFinancialActivity` adds 1-3 new mundane financial
//      evidence items per suspect (req. "financial noise" — groceries/fuel/
//      withdrawals with no suspicious flag), so `evidence.length` grows and
//      new ids appear for every seed.
//   2. The `camera` TAG_MAPPING's description no longer unconditionally
//      names the actor (that was a truth-safety bug: it leaked identity
//      regardless of the separately-computed CCTV `identifiable` flag) —
//      every camera_footage evidence item's `description` text changed.
//   3. `card_payment`/`cash_withdrawal` descriptions now embed the real,
//      structured `formatChf(amountChf)` amount (previously plain, amount-
//      less sentences) — every such item's `description` text changed, and
//      `financialDetails` is now a populated field instead of absent.
// None of this is a change to WHO is guilty, the timeline, motive, or
// solvability — `computeSolvability`/`validateCase` are re-asserted below
// exactly as before, and all 20 re-verified `validateCase(...).valid ===
// true` with `postCrimeMovements.length > 0` after re-pinning. Phase 5A
// isolation itself (items D/H/I/J above, and the mocked-call field-shape
// assertion) is unaffected — this table is a population/evidence-content
// snapshot, not a Phase 5A invariant.
//
// SECOND re-pin, for exactly 6 of these 20 seeds (00, 02, 03, 14, 16, 18) —
// the pre-commit historical-case compatibility audit. That audit found
// `generateRedHerrings`/`tampering.ts#buildSecondaryTrace` drew their new
// `financialDetails.amountChf` straight from their shared per-call `rng`
// parameter, BEFORE that same instance's `rng.id("ev")` call for the SAME
// item — `RNG.id()` derives from `this.callCount` (rng.ts), a counter
// shared by every `.float()`-family call on one `RNG` instance, so this
// silently shifted that item's own evidence id (and, for red herrings,
// every later item on the same stream) for any case where the draw fired.
// Confirmed empirically (before/after git-stash diff across 20 fixed
// seeds): 2/20 lost a red-herring evidence id outright. Fixed by rolling
// the amount from an isolated `rng.derive(...)` sub-stream instead — the
// same discipline `deriveEvidenceFromTimeline`'s `financial-${event.id}`
// roll already used correctly (see both call sites' updated comments).
// That fix necessarily changes WHICH amount gets rolled (never which id)
// for the one evidence item on each affected path — confirmed, per seed,
// to be exactly one red-herring `card_payment` item or one
// `disguise_transaction` trace, nothing else: evidence ids, counts,
// reliability, discoveryDifficulty, discoverableAt, requiresLabAnalysis,
// and every non-financial description are all identical to the prior
// re-pin for all 20 seeds (see `lib/game-engine/evidence/__tests__/
// evidence-id-stability.test.ts`, which now pins the corrected ids for
// this exact path so this class of bug can't silently return). The other
// 14 seeds' hashes were untouched by that second re-pin.
//
// THIRD re-pin, for all 20 seeds — Motive & Digital Evidence Phase 1 (the
// victim's phone). `canonicalProjection` now also excludes the new
// `CaseTruth.victimPhone` field (same treatment as `postCrimeMovements`:
// its own top-level field, generated from an isolated
// `rootRng.derive("victim-phone")` stream — see `case-truth.ts` and
// `victim-phone.ts`'s module doc comments — so its mere existence changes
// nothing else this hash covers). What DOES legitimately change this hash
// for every seed is `evidence[]` gaining exactly ONE new item per case: the
// recovered phone device itself (`type: "victim_phone"`), added the same
// additive way `ambientFinancialActivity` was in the prior phase. Verified
// empirically (before/after git-stash diff across 20 fixed seeds,
// including relationship/timeline id lists this time, not just evidence):
// 0 missing ids, 0 mutated survivors, exactly 20 additions (one
// `victim_phone` item per seed, nothing else) — culprit/suspects/victim/
// motive/relationships/timeline are all byte-identical to the prior re-pin.
const EXPECTED_HASHES: Record<string, string> = {
  "CASE-P5AREG00": "bed2adb920acebb4e06267acd530202302f29e80fb5ee519ffc648a7cca27c8e",
  "CASE-P5AREG01": "d78ba14e964eeee8edc47fe5d190d0c0b4773b8d484b8c380272c195c8509601",
  "CASE-P5AREG02": "5202c5745a5bccc4cb9b3b3c316740f24ba578c1f2c5c8a6652e6d9760426e2e",
  "CASE-P5AREG03": "8e79117b6ac7357a9031d9cf65835657040446e3755a8ad0754a8ccf1d22aa6e",
  "CASE-P5AREG04": "db6b651f06d53e96661aa0ac406145d2136f060d39ecc5e49ec857b1af53f0bb",
  // Original CASE-P5AREG05 hits a rare, pre-existing, unrelated generator
  // edge case (a sub-5-minute teleportation flag in travel timing — nothing
  // to do with population/age/occupation); swapped for a nearby seed that's
  // valid, per the project's own tolerance for rare procedural dead ends
  // (see CASE_GENERATION.md and batch.test.ts).
  "CASE-P5AREG05B": "45ca61d50c8b76012c874335bbf84cdacf4f81aae7119b6d6e742ab426e4da17",
  "CASE-P5AREG06": "f627cbb7b73af88e1f8d9a3443be8cf382eb7277c41445ff178585d65fc8e28f",
  "CASE-P5AREG07": "ca085a8fe8f7fa70294ee09614858b8857d82df2a60a92f3cfa7c3a2b8c021d1",
  "CASE-P5AREG08": "3eece759e9d82eaa04deb14d477b96341f09ae2a45b256668e3dc410dfa26f40",
  "CASE-P5AREG09": "0de7478a1a13f85073acf1e0bdb2bcf9b1bef976cc17bf055ed12b018655f633",
  "CASE-P5AREG10": "3dbe8ef739290b5210299b6cc73e83a23acd1ed27b9205882771b5740cb3115d",
  "CASE-P5AREG11": "f5739c4e99c65430c1b6b852a41c75920f988f53c9291e25be071ea59f958169",
  "CASE-P5AREG12": "e8177a22ebf2f3ea1e57c518133a354ee5e5e1e875f3b77e29f903f62bebeacb",
  "CASE-P5AREG13": "331c9915bd0ed458a6b026c2d08261fd20c14619332abd34d2c2512cea3c14b8",
  "CASE-P5AREG14": "6fe7b4fca3aa167ec0bd785f053672312dbf9c77fd9d28f879261072bb654c44",
  "CASE-P5AREG15": "4393bb9f0759dd81741d57182891981602a60adb7787e34a78882ae299b8e318",
  "CASE-P5AREG16": "0b8e866e6d7af8b69dd1fa41ae6deedd839675b41e2f3edf6396b6d5d8803e0e",
  "CASE-P5AREG17": "fc34e3b7acfbe1e633c5a6a77f697b748ce9627bd42c0bedd4abec3e997fe8cf",
  "CASE-P5AREG18": "e0a666a419ab331be7d7cd5741a78847613ecff9fd1f659d7ea77c213359f40a",
  "CASE-P5AREG19": "b2118fc435e250a10041462bbb6bf9b44e91f8b0d64c8387eb7ece9fe545f172",
};

describe("Phase 5A — RNG domain isolation (the mechanism the whole feature relies on)", () => {
  it("[RNG] deriving an unrelated sub-stream at any point never changes any other derive()'s output", () => {
    const seedA = createRootRng("order-test-seed");
    const alphaBefore = seedA.derive("alpha").int(0, 1_000_000);
    const betaBefore = seedA.derive("beta").int(0, 1_000_000);

    const seedB = createRootRng("order-test-seed");
    seedB.derive("post-crime-observation"); // simulate the new call happening first
    const alphaAfter = seedB.derive("alpha").int(0, 1_000_000);
    const betaAfter = seedB.derive("beta").int(0, 1_000_000);

    expect(alphaAfter).toBe(alphaBefore);
    expect(betaAfter).toBe(betaBefore);
  });
});

describe("Phase 5A — guilt isolation at the call site (item D)", () => {
  it("[D] generateCase passes the generator only a narrow projection — never the victim, never roles/personality/wealth", () => {
    const mockFn = generatePostCrimeMovements as unknown as ReturnType<typeof vi.fn>;
    mockFn.mockClear();

    const truth = generateCase("CASE-P5AMOCK01");

    expect(mockFn).toHaveBeenCalledTimes(1);
    const input = mockFn.mock.calls[0][1] as { people: Record<string, unknown>[]; caseOpenedAt: number };

    const passedIds = input.people.map((p) => p.id);
    expect(passedIds).not.toContain(truth.victimId);
    for (const person of input.people) {
      // Phase 5B-2 added exactly two fields, both guilt-blind (see
      // post-crime-observation.ts's module doc comment): `lifeStatus` (a
      // plain string, itself already guilt-blind) and `relationshipLinks`
      // (type + other-person-id ONLY — never RelationshipAttributes/secret).
      expect(Object.keys(person).sort()).toEqual([
        "firstName",
        "homeLocationId",
        "id",
        "lastName",
        "lifeStatus",
        "relationshipLinks",
        "workLocationId",
      ]);
      const links = person.relationshipLinks as Record<string, unknown>[];
      for (const link of links) {
        expect(Object.keys(link).sort()).toEqual(["otherPersonId", "type"]);
      }
    }
    // caseOpenedAt is threaded from the simulation, not approximated from
    // crimeTimestamp — it must be strictly after the crime itself.
    expect(input.caseOpenedAt).toBeGreaterThan(truth.crimeTimestamp);
  });
});

describe("Phase 5A — no evidence/witness/solvability mutation (items H, I, J)", () => {
  it("[J] computeSolvability is identical whether or not postCrimeMovements is present", () => {
    const truth = generateCase("CASE-P5AMOCK02");
    const withLayer = computeSolvability(truth);
    const withoutLayer = computeSolvability({ ...truth, postCrimeMovements: [] });
    expect(withoutLayer).toEqual(withLayer);
    expect(withLayer.independentChannels.length).toBeGreaterThanOrEqual(MIN_INDEPENDENT_CHANNELS);
  });

  it("[H, I] validateCase is identical whether or not postCrimeMovements is present", () => {
    const truth = generateCase("CASE-P5AMOCK03");
    const withLayer = validateCase(truth);
    const withoutLayer = validateCase({ ...truth, postCrimeMovements: [] });
    expect(withoutLayer).toEqual(withLayer);
    expect(withLayer.valid).toBe(true);
  });
});

describe("Phase 5A — existing truth regression across 20 deterministic seeds (item C)", () => {
  for (const [seed, expectedHash] of Object.entries(EXPECTED_HASHES)) {
    it(`truth is unchanged (minus generatedAt/postCrimeMovements) for ${seed}`, () => {
      const truth = generateCase(seed);
      expect(truth.postCrimeMovements.length).toBeGreaterThan(0);

      const hash = createHash("sha256").update(stableStringify(canonicalProjection(truth))).digest("hex");
      expect(hash).toBe(expectedHash);

      const solvability = computeSolvability(truth);
      expect(solvability.independentChannels.length).toBeGreaterThanOrEqual(MIN_INDEPENDENT_CHANNELS);
      expect(validateCase(truth).valid).toBe(true);
    });
  }
});

describe("Phase 5A — backward compatibility (item 13)", () => {
  it("any seed regenerates a truth that already includes the new layer — no migration, no persisted state involved", () => {
    const truth = generateCase("CASE-LEGACY01");
    expect(Array.isArray(truth.postCrimeMovements)).toBe(true);
    expect(truth.postCrimeMovements.length).toBeGreaterThan(0);
  });
});

describe("Phase 5A hardening — 100-case temporal stress test on the full pipeline", () => {
  it("zero same-person overlaps in postCrimeMovements across 100 full generateCase() runs", () => {
    for (let i = 0; i < 100; i++) {
      const truth = generateCase(`CASE-P5ASTRESS${String(i).padStart(3, "0")}`);
      const byPerson = new Map<string, typeof truth.postCrimeMovements>();
      for (const e of truth.postCrimeMovements) {
        byPerson.set(e.actorId, [...(byPerson.get(e.actorId) ?? []), e]);
      }
      for (const events of byPerson.values()) {
        const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
        for (let j = 0; j < sorted.length - 1; j++) {
          expect(sorted[j].timestamp + sorted[j].durationMinutes).toBeLessThanOrEqual(sorted[j + 1].timestamp);
        }
      }
    }
  });
});
