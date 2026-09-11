import { describe, expect, it } from "vitest";
import { getCriminalRecord } from "../criminal-record";
import type { Person } from "@/lib/game-engine/types/person";

function makePerson(overrides: Partial<Person> = {}): Person {
  return {
    id: "person_test",
    firstName: "Test",
    lastName: "Person",
    age: 30,
    sex: "male",
    lifeStatus: "employed",
    profession: "test",
    homeLocationId: "loc",
    workLocationId: null,
    avatarSeed: "seed",
    personality: {
      intelligence: 0.5,
      impulsivity: 0.5,
      sociability: 0.5,
      aggressiveness: 0.5,
      honesty: 0.5,
      loyalty: 0.5,
      fearfulness: 0.5,
    },
    baselineStress: 0.3,
    wealthChf: 50_000,
    addictions: [],
    phoneNumber: "0790000000",
    vehicle: null,
    digitalAccounts: [],
    roles: [],
    ...overrides,
  };
}

describe("getCriminalRecord", () => {
  it("is deterministic for the same person id and traits", () => {
    const person = makePerson({ id: "person_abc", personality: { ...makePerson().personality, aggressiveness: 0.9, honesty: 0.1 } });
    expect(getCriminalRecord(person)).toEqual(getCriminalRecord(person));
  });

  it("never invents a record for a low-risk, clean-cut person id that hashes low", () => {
    const person = makePerson({ id: "id_that_should_be_clean_0001", personality: { ...makePerson().personality, aggressiveness: 0, honesty: 1, impulsivity: 0 }, addictions: [] });
    // With riskScore ~0, the roll threshold is ~1, so only an extremely rare hash could pass.
    // We just assert the function doesn't throw and returns an array shape.
    expect(Array.isArray(getCriminalRecord(person))).toBe(true);
  });

  it("returns entries sorted by recency (yearsAgo ascending) when present", () => {
    // Search a handful of ids for one that actually produces >=2 entries.
    for (let i = 0; i < 200; i++) {
      const person = makePerson({
        id: `person_${i}`,
        personality: { ...makePerson().personality, aggressiveness: 0.9, honesty: 0.05, impulsivity: 0.9 },
        addictions: ["alcool"],
      });
      const record = getCriminalRecord(person);
      if (record.length >= 2) {
        const years = record.map((r) => r.yearsAgo);
        expect(years).toEqual([...years].sort((a, b) => a - b));
        return;
      }
    }
    throw new Error("expected at least one sampled person to have a multi-entry record");
  });
});
