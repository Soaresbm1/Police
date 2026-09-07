import { describe, expect, it } from "vitest";
import { generateCase } from "../case-generator/case-truth";
import { validateCase } from "../validator/case-validator";

describe("smoke: generateCase", () => {
  it("generates a structurally complete case for a fixed seed", () => {
    const truth = generateCase("CASE-000001", { difficulty: "investigator" });
    expect(truth.people.length).toBeGreaterThan(5);
    expect(truth.timeline.length).toBeGreaterThan(10);
    expect(truth.evidence.length).toBeGreaterThan(0);

    const validation = validateCase(truth);
    if (!validation.valid) {
      console.log("VALIDATION ERRORS", validation.errors);
      console.log("VALIDATION WARNINGS", validation.warnings);
    }
    expect(validation.valid).toBe(true);
  });
});
