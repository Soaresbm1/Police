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

/** Everything in CaseTruth except the wall-clock timestamp and the new
 * Phase 5A layer — this is the projection that must never change as a
 * side effect of adding postCrimeMovements. */
function canonicalProjection(truth: CaseTruth): Omit<CaseTruth, "generatedAt" | "postCrimeMovements"> {
  const rest: Partial<CaseTruth> = { ...truth };
  delete rest.generatedAt;
  delete rest.postCrimeMovements;
  return rest as Omit<CaseTruth, "generatedAt" | "postCrimeMovements">;
}

// Pinned baseline hashes of canonicalProjection(generateCase(seed)), captured
// from the current, verified-correct implementation (cross-checked via an
// empirical git-stash before/after diff across the same 20+ seeds while
// this feature was built — see Phase 5A report). If any future change alters
// anything other than postCrimeMovements/generatedAt for these seeds, this
// test catches it immediately.
const EXPECTED_HASHES: Record<string, string> = {
  "CASE-P5AREG00": "411cd35fcd9457a848e884db48f71c10b477e93a5afe20b80ced45ac585b70c6",
  "CASE-P5AREG01": "ae2f87487b31afbcc4d8c97cd13d6eab754af3e597e446ce8ac00b93e7840c40",
  "CASE-P5AREG02": "c2b22048bc6345b8b41afc33569af25052ef70eaabe129becf6f8e6bdd68e3d8",
  "CASE-P5AREG03": "74fd9a16d79a65303f3416d4952e4ac0a0b1ba04e636438a468940d3bc70bc2e",
  "CASE-P5AREG04": "aee1060b11976146fcf9a7def7184b0cc38e0a051b31b727500649a66c43a72b",
  "CASE-P5AREG05": "cbd421037481257e0f7d1c91dac67688668b459d73c123cccc457248df18e90d",
  "CASE-P5AREG06": "dd8390a2f1aa6ce8cead59663b394163cfb9fab4fd9e75a1baf48fedd7c5a687",
  "CASE-P5AREG07": "09c029f16705df5881daaead45a5190a49383a720a7605692a7c5cc3cd669003",
  "CASE-P5AREG08": "2c4f48a145fff824b4a2b6ec64c5fd3d9dd4c335d86e19402c39dc3fa8adf9bf",
  "CASE-P5AREG09": "e142063ce057032e0aedd57b3284fce7b8d34a6aff553222b2d9dd49e6645355",
  "CASE-P5AREG10": "df266886ddddc9b5fe4375a704821b4a33767ef742f85a0a359a0cd933f4396e",
  "CASE-P5AREG11": "eb65fa32710ed9392366a2973fc60e99804c5b15fe561d315783b5a6c64fd1d4",
  "CASE-P5AREG12": "2c6a2b15d6d4a147001b4af4cb3e2c7203d7290d24732dec691c98ec1270c175",
  "CASE-P5AREG13": "3a3a064da7d5eb2b79006bde33df896c910406fdada593e961e52f8cb15b01ab",
  "CASE-P5AREG14": "d4f74eb582f348534ef657e91637248fe8d9d717f87177695feca8cc054db2b8",
  "CASE-P5AREG15": "635ca00ee1d7e62e10733ac9d571e0a04fbd045d89778984244f0988fbd15e16",
  "CASE-P5AREG16": "c9f51ef790978ad838416bcd6a7d9c8149a163037af47b850c588560abf4c909",
  "CASE-P5AREG17": "95be7b41f19b96c60319cbea2e087e3832e14540b5485a6813248e05769a8932",
  "CASE-P5AREG18": "e9945e7b8de4b4529c3abe6b65cfdfbafc2319c6b63106f05589c50897aeb1db",
  "CASE-P5AREG19": "b6accedf1a74beda5dded7d449527672059e23fb991ecdd884961f3f135c1847",
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
      expect(Object.keys(person).sort()).toEqual(["firstName", "homeLocationId", "id", "lastName", "workLocationId"]);
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
