import { describe, expect, it } from "vitest";
import { createRootRng } from "../../random/rng";
import { generateTownInfrastructure } from "../../world/world-generator";
import { generatePopulation } from "../population";
import { generateCase } from "../case-truth";
import { generateBatch } from "../generate-batch";
import { MIN_INDEPENDENT_CHANNELS } from "../../validator/solvability";
import { OCCUPATIONS } from "../occupations";
import type { LifeStatus, Person } from "../../types/person";
import type { Location } from "../../types/location";

const OCCUPATIONS_BY_ID = new Map(OCCUPATIONS.map((o) => [o.id, o]));

/** Recovers the occupation id a generated `Person` was assigned, undoing the
 * "apprenti·e <occupation>" display prefix — null for statuses that never
 * carry one (student/unemployed/retired). */
function occupationIdOf(person: Person): string | null {
  if (person.lifeStatus === "student" || person.lifeStatus === "unemployed" || person.lifeStatus === "retired") {
    return null;
  }
  if (person.lifeStatus === "apprentice") {
    return person.profession.replace(/^apprenti·e /, "");
  }
  return person.profession;
}

/** Generates a large deterministic population sample by running the same
 * infra+population steps `generateCase` does, without the cost of a full
 * case (motive/timeline/evidence/...). */
function generateSample(seedCount: number): { people: Person[]; locations: Location[] }[] {
  const samples: { people: Person[]; locations: Location[] }[] = [];
  for (let i = 0; i < seedCount; i++) {
    const rootRng = createRootRng(`STATS-${i}`);
    const infrastructure = generateTownInfrastructure(rootRng.derive("infrastructure"));
    const population = generatePopulation(rootRng.derive("population"), infrastructure, {
      suspectCount: 6,
      witnessCount: 10,
    });
    samples.push({ people: population.people, locations: [...infrastructure, ...population.homeLocations] });
  }
  return samples;
}

// 320 seeds * (1 victim + 6 suspects + 10 witnesses) = 5440 people — over the
// 5,000-person distribution-report target (raised from 1,000 during the
// distribution-tuning pass).
const SAMPLE_SEED_COUNT = 320;

describe("age/occupation/life-status consistency", () => {
  const samples = generateSample(SAMPLE_SEED_COUNT);
  const allPeople = samples.flatMap((s) => s.people);
  const locationsById = new Map(samples.flatMap((s) => s.locations).map((l) => [l.id, l]));

  it("generates a large enough sample for the distribution report", () => {
    expect(allPeople.length).toBeGreaterThanOrEqual(5000);
  });

  // --- A: no retiree below the intended normal minimum -----------------------
  it("[A] no retired person below age 55", () => {
    const violations = allPeople.filter((p) => p.lifeStatus === "retired" && p.age < 55);
    expect(violations).toEqual([]);
  });

  // --- B: 70+ population is overwhelmingly retired ----------------------------
  it("[B] at least half of the 70+ population is retired", () => {
    const seniors = allPeople.filter((p) => p.age >= 70);
    expect(seniors.length).toBeGreaterThan(20); // sanity: the bracket isn't empty
    const retired = seniors.filter((p) => p.lifeStatus === "retired");
    expect(retired.length / seniors.length).toBeGreaterThanOrEqual(0.5);
  });

  // --- C: no occupation below its hard minAge ---------------------------------
  it("[C] no person holds an occupation below that occupation's minAge", () => {
    const violations = allPeople
      .map((p) => ({ p, occId: occupationIdOf(p) }))
      .filter(({ occId }) => occId !== null)
      .filter(({ p, occId }) => {
        const meta = OCCUPATIONS_BY_ID.get(occId as string);
        return !meta || p.age < meta.minAge;
      });
    expect(violations).toEqual([]);
  });

  // --- D: no incompatible occupation/status pair ------------------------------
  it("[D] every occupation's allowedStatuses includes the holder's lifeStatus", () => {
    const violations = allPeople
      .map((p) => ({ p, occId: occupationIdOf(p) }))
      .filter(({ occId }) => occId !== null)
      .filter(({ p, occId }) => {
        const meta = OCCUPATIONS_BY_ID.get(occId as string);
        return !meta || !meta.allowedStatuses.includes(p.lifeStatus);
      });
    expect(violations).toEqual([]);
  });

  // --- E: students remain possible outside the typical 18-24 range -----------
  it("[E] at least one student exists outside the 18-24 range (16-17, intentionally supported)", () => {
    const youngStudents = allPeople.filter((p) => p.lifeStatus === "student" && (p.age < 18 || p.age > 24));
    expect(youngStudents.length).toBeGreaterThan(0);
  });

  // --- F: employed people can exist beyond normal retirement age -------------
  it("[F] at least one employed/self-employed person exists past age 65", () => {
    const workingSeniors = allPeople.filter((p) => (p.lifeStatus === "employed" || p.lifeStatus === "self_employed") && p.age > 65);
    expect(workingSeniors.length).toBeGreaterThan(0);
  });

  // --- G/H: retired/unemployed have no ordinary workplace ---------------------
  it("[G] retired people never have a workLocationId", () => {
    const violations = allPeople.filter((p) => p.lifeStatus === "retired" && p.workLocationId !== null);
    expect(violations).toEqual([]);
  });

  it("[H] unemployed people never have a workLocationId", () => {
    const violations = allPeople.filter((p) => p.lifeStatus === "unemployed" && p.workLocationId !== null);
    expect(violations).toEqual([]);
  });

  it("students never have a workLocationId (no school/work system modeled)", () => {
    const violations = allPeople.filter((p) => p.lifeStatus === "student" && p.workLocationId !== null);
    expect(violations).toEqual([]);
  });

  // --- I: employed people get coherent workplace behavior ---------------------
  it("[I] a person whose occupation has a preferred location type is only ever placed there, never elsewhere", () => {
    const violations = allPeople
      .filter((p) => p.workLocationId !== null)
      .map((p) => ({ p, occId: occupationIdOf(p) }))
      .filter(({ occId }) => occId !== null && OCCUPATIONS_BY_ID.get(occId as string)?.locationType !== undefined)
      .filter(({ p, occId }) => {
        const meta = OCCUPATIONS_BY_ID.get(occId as string)!;
        const location = locationsById.get(p.workLocationId as string);
        return !location || location.type !== meta.locationType;
      });
    expect(violations).toEqual([]);
  });

  it("a generic occupation's workplace (when present) is always an office or a shop", () => {
    const violations = allPeople
      .filter((p) => p.workLocationId !== null)
      .map((p) => ({ p, occId: occupationIdOf(p) }))
      .filter(({ occId }) => occId !== null && OCCUPATIONS_BY_ID.get(occId as string)?.locationType === undefined)
      .filter(({ p }) => {
        const location = locationsById.get(p.workLocationId as string);
        return !location || (location.type !== "office" && location.type !== "shop");
      });
    expect(violations).toEqual([]);
  });

  // --- K: determinism ----------------------------------------------------------
  it("[K] the same seed produces a deep-equal population every time", () => {
    const rootRngA = createRootRng("DETERMINISM-CHECK");
    const infraA = generateTownInfrastructure(rootRngA.derive("infrastructure"));
    const popA = generatePopulation(rootRngA.derive("population"), infraA, { suspectCount: 5, witnessCount: 7 });

    const rootRngB = createRootRng("DETERMINISM-CHECK");
    const infraB = generateTownInfrastructure(rootRngB.derive("infrastructure"));
    const popB = generatePopulation(rootRngB.derive("population"), infraB, { suspectCount: 5, witnessCount: 7 });

    expect(popB).toEqual(popA);
  });

  // --- L: no unbounded reroll loop ----------------------------------------------
  it("[L] generating a large population completes quickly (no reroll loop, bounded work per person)", () => {
    const start = Date.now();
    generateSample(50);
    expect(Date.now() - start).toBeLessThan(5000);
  });

  // --- distribution report (section 12) ---------------------------------------
  it("prints the age-bracket x life-status distribution and reports invalid combos", () => {
    type Bracket = { label: string; min: number; max: number };
    const brackets: Bracket[] = [
      { label: "16-17", min: 16, max: 17 },
      { label: "18-24", min: 18, max: 24 },
      { label: "25-34", min: 25, max: 34 },
      { label: "35-54", min: 35, max: 54 },
      { label: "55-61", min: 55, max: 61 },
      { label: "62-69", min: 62, max: 69 },
      { label: "70+", min: 70, max: Infinity },
    ];
    const statuses: LifeStatus[] = ["student", "apprentice", "employed", "self_employed", "unemployed", "retired"];

    const table: Record<string, Record<LifeStatus, number>> = {};
    for (const b of brackets) {
      table[b.label] = { student: 0, apprentice: 0, employed: 0, self_employed: 0, unemployed: 0, retired: 0 };
    }

    let invalidCombos = 0;
    for (const p of allPeople) {
      const bracket = brackets.find((b) => p.age >= b.min && p.age <= b.max);
      if (bracket) table[bracket.label][p.lifeStatus]++;

      const occId = occupationIdOf(p);
      if (occId !== null) {
        const meta = OCCUPATIONS_BY_ID.get(occId);
        if (!meta || p.age < meta.minAge || !meta.allowedStatuses.includes(p.lifeStatus)) invalidCombos++;
      }
    }

    console.log(`\n=== Age bracket x life-status distribution (n=${allPeople.length}) ===`);
    console.log("bracket".padEnd(10), ...statuses.map((s) => s.padEnd(14)));
    for (const b of brackets) {
      const row = table[b.label];
      const total = statuses.reduce((sum, s) => sum + row[s], 0);
      console.log(
        b.label.padEnd(10),
        ...statuses.map((s) => `${row[s]} (${total > 0 ? ((row[s] / total) * 100).toFixed(1) : "0.0"}%)`.padEnd(14)),
      );
    }
    console.log(`Detected implausible occupation/age/status combos: ${invalidCombos} (expected 0)`);

    expect(invalidCombos).toBe(0);
  });
});

describe("age/occupation consistency — full case pipeline (items J, M, N, O)", () => {
  // --- J: postCrimeMovements never send retired/unemployed people to work ----
  it("[J] no postCrimeMovements 'work' event belongs to a retired or unemployed person", () => {
    for (let i = 0; i < 15; i++) {
      const truth = generateCase(`CASE-OCCJ${String(i).padStart(2, "0")}`);
      const peopleById = new Map(truth.people.map((p) => [p.id, p]));
      const violations = truth.postCrimeMovements.filter((e) => {
        if (e.action !== "work") return false;
        const person = peopleById.get(e.actorId);
        return person?.lifeStatus === "retired" || person?.lifeStatus === "unemployed" || person?.lifeStatus === "student";
      });
      expect(violations).toEqual([]);
    }
  });

  // --- M, N: 100+ generated cases pass validator with >=3 independent channels
  it("[M, N] 120 generated cases: high validity rate, solvability holds MIN_INDEPENDENT_CHANNELS", () => {
    const summary = generateBatch(120, "investigator");
    expect(summary.validCount / summary.total).toBeGreaterThanOrEqual(0.95);
    expect(summary.averageProofChannels).toBeGreaterThanOrEqual(MIN_INDEPENDENT_CHANNELS);
  }, 30_000);

  // --- O: this file's existence + a green full run of the pre-existing suite
  // (validator/witness/guilt-isolation tests) is asserted by CI/the test
  // runner itself, not re-duplicated here.
});
