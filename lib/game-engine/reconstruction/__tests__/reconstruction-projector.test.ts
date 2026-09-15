import { describe, expect, it } from "vitest";
import { generateCase } from "../../case-generator/case-truth";
import type { CaseTruth } from "../../types/case";
import { projectReconstruction } from "../reconstruction-projector";
import { findPocCase } from "./poc-case-finder";

const SAFE_SEED = "CASE-B00001";
const CASE_ID = "case-history-row-id-0001";

function projectOrThrow(truth: CaseTruth, caseId = CASE_ID) {
  const result = projectReconstruction(truth, caseId);
  if (!result.ok) throw new Error(`expected a successful projection, got: ${result.reason}`);
  return result.scenario;
}

/** Every key that is allowed to exist anywhere in a serialized
 * ReconstructionScenario, at any nesting depth — the structural half of the
 * serialization-safety proof (U5.0 §21): if a forbidden CaseTruth field
 * ever leaked in, its key would not be in this set and the recursive walk
 * below would fail, independent of what string content it happened to
 * contain. */
const ALLOWED_KEYS = new Set([
  "version",
  "caseId",
  "environment",
  "durationSeconds",
  "actors",
  "events",
  "visualId",
  "roleForReconstruction",
  "genericAppearance",
  "spawnTime",
  "despawnTime",
  "waypoints",
  "time",
  "slot",
  "type",
  "actorVisualId",
  "counterpartyVisualId",
  "locationSlot",
  "safeVisualAction",
]);

function collectKeysRecursively(value: unknown, keys: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectKeysRecursively(item, keys);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, v] of Object.entries(value)) {
      keys.add(key);
      collectKeysRecursively(v, keys);
    }
  }
}

describe("projectReconstruction — determinism", () => {
  it("same CaseTruth + same caseId produces byte-equivalent JSON", () => {
    const truth = generateCase(SAFE_SEED, { difficulty: "investigator" });
    const a = projectOrThrow(truth);
    const b = projectOrThrow(truth);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("regenerating the same seed+difficulty twice yields byte-equivalent scenarios (historical regeneration determinism)", () => {
    const truthA = generateCase(SAFE_SEED, { difficulty: "investigator" });
    const truthB = generateCase(SAFE_SEED, { difficulty: "investigator" });
    const scenarioA = projectOrThrow(truthA);
    const scenarioB = projectOrThrow(truthB);
    expect(JSON.stringify(scenarioA)).toBe(JSON.stringify(scenarioB));
  });

  it("a different caseId for the same truth changes the visual ids but not the structure", () => {
    const truth = generateCase(SAFE_SEED, { difficulty: "investigator" });
    const a = projectOrThrow(truth, "case-id-one");
    const b = projectOrThrow(truth, "case-id-two");
    expect(a.actors.map((x) => x.visualId)).not.toEqual(b.actors.map((x) => x.visualId));
    expect(a.actors.length).toBe(b.actors.length);
    expect(a.events.length).toBe(b.events.length);
  });
});

describe("projectReconstruction — caseId safety", () => {
  it("rejects an empty caseId", () => {
    const truth = generateCase(SAFE_SEED, { difficulty: "investigator" });
    const result = projectReconstruction(truth, "");
    expect(result.ok).toBe(false);
  });

  it("rejects the case seed itself as caseId", () => {
    const truth = generateCase(SAFE_SEED, { difficulty: "investigator" });
    const result = projectReconstruction(truth, truth.seed);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/seed/i);
  });
});

describe("projectReconstruction — serialization safety", () => {
  it("every key in the serialized scenario, at every depth, is on the allowed list (structural proof)", () => {
    const truth = generateCase(SAFE_SEED, { difficulty: "investigator" });
    const scenario = projectOrThrow(truth);
    const foundKeys = new Set<string>();
    collectKeysRecursively(scenario, foundKeys);
    for (const key of foundKeys) {
      expect(ALLOWED_KEYS.has(key), `unexpected key "${key}" found in serialized ReconstructionScenario`).toBe(true);
    }
  });

  it("the serialized scenario never contains the case seed (substring defense-in-depth)", () => {
    const truth = generateCase(SAFE_SEED, { difficulty: "investigator" });
    const scenario = projectOrThrow(truth);
    const json = JSON.stringify(scenario);
    expect(json).not.toContain(truth.seed);
  });

  it("the serialized scenario never contains any raw PersonId", () => {
    const truth = generateCase(SAFE_SEED, { difficulty: "investigator" });
    const scenario = projectOrThrow(truth);
    const json = JSON.stringify(scenario);
    for (const person of truth.people) {
      expect(json, `raw PersonId "${person.id}" leaked into the scenario`).not.toContain(person.id);
    }
    expect(json).not.toContain(truth.victimId);
    expect(json).not.toContain(truth.culpritId);
  });

  it("the serialized scenario never contains any raw LocationId", () => {
    const truth = generateCase(SAFE_SEED, { difficulty: "investigator" });
    const scenario = projectOrThrow(truth);
    const json = JSON.stringify(scenario);
    for (const location of truth.locations) {
      expect(json, `raw LocationId "${location.id}" leaked into the scenario`).not.toContain(location.id);
    }
  });

  it("the serialized scenario never contains the motive description, weapon string, or method prose", () => {
    const truth = generateCase(SAFE_SEED, { difficulty: "investigator" });
    const scenario = projectOrThrow(truth);
    const json = JSON.stringify(scenario);
    if (truth.motive.description) expect(json).not.toContain(truth.motive.description);
    expect(json).not.toContain(truth.method);
    expect(json).not.toContain(truth.weapon);
  });

  it("the serialized scenario never contains any relationship secret", () => {
    const truth = generateCase(SAFE_SEED, { difficulty: "investigator" });
    const scenario = projectOrThrow(truth);
    const json = JSON.stringify(scenario);
    for (const relationship of truth.relationships) {
      if (relationship.secret) expect(json).not.toContain(relationship.secret);
    }
  });

  it("the serialized scenario never contains any evidence description or testimony/knowledge statement", () => {
    const truth = generateCase(SAFE_SEED, { difficulty: "investigator" });
    const scenario = projectOrThrow(truth);
    const json = JSON.stringify(scenario);
    for (const item of truth.evidence) {
      if (item.description) expect(json).not.toContain(item.description);
    }
    for (const line of truth.testimony) {
      if (line.statement) expect(json).not.toContain(line.statement);
    }
    for (const fact of truth.knowledge) {
      expect(json).not.toContain(fact.trueStatement);
    }
  });

  it("the serialized scenario never contains any raw TimelineEvent description", () => {
    const truth = generateCase(SAFE_SEED, { difficulty: "investigator" });
    const scenario = projectOrThrow(truth);
    const json = JSON.stringify(scenario);
    for (const event of truth.timeline) {
      if (event.description) expect(json).not.toContain(event.description);
    }
  });
});

describe("projectReconstruction — actor disclosure rules", () => {
  it("only assigns the victim/culprit roles to CaseTruth.victimId/.culpritId", () => {
    const truth = generateCase(SAFE_SEED, { difficulty: "investigator" });
    const scenario = projectOrThrow(truth);
    const victimActors = scenario.actors.filter((a) => a.roleForReconstruction === "victim");
    const culpritActors = scenario.actors.filter((a) => a.roleForReconstruction === "culprit");
    expect(victimActors.length).toBeLessThanOrEqual(1);
    expect(culpritActors.length).toBe(1);
  });

  it("never assigns more than one culprit and one victim role across many generated cases", () => {
    for (let i = 0; i < 15; i++) {
      const truth = generateCase(`CASE-C${i.toString().padStart(5, "0")}`, { difficulty: "investigator" });
      const scenario = projectOrThrow(truth);
      expect(scenario.actors.filter((a) => a.roleForReconstruction === "culprit").length).toBe(1);
      expect(scenario.actors.filter((a) => a.roleForReconstruction === "victim").length).toBeLessThanOrEqual(1);
    }
  });

  it("a discoverer distinct from victim/culprit/accomplices is rendered unnamed", () => {
    // Search a handful of seeds for one whose discover event's actor differs
    // from culprit/victim/every accomplice — the overwhelmingly common case
    // per the generator's own pickDiscoverer logic.
    for (let i = 0; i < 30; i++) {
      const truth = generateCase(`CASE-D${i.toString().padStart(5, "0")}`, { difficulty: "investigator" });
      const scenario = projectOrThrow(truth);
      const discoverEvent = scenario.events.find((e) => e.type === "discover");
      if (!discoverEvent) continue;
      const discovererActor = scenario.actors.find((a) => a.visualId === discoverEvent.actorVisualId);
      if (!discovererActor) continue;
      if (discovererActor.roleForReconstruction === "victim" || discovererActor.roleForReconstruction === "culprit" || discovererActor.roleForReconstruction === "accomplice") {
        continue; // rare overlap — not the case we're proving here
      }
      expect(discovererActor.roleForReconstruction).toBe("unnamed");
      return;
    }
    throw new Error("no generated case in this search range had a distinct, non-involved discoverer to test against");
  });

  it("never expands disclosure beyond victim/culprit/accomplice/unnamed", () => {
    for (let i = 0; i < 15; i++) {
      const truth = generateCase(`CASE-E${i.toString().padStart(5, "0")}`, { difficulty: "investigator" });
      const scenario = projectOrThrow(truth);
      for (const actor of scenario.actors) {
        expect(["victim", "culprit", "accomplice", "unnamed"]).toContain(actor.roleForReconstruction);
      }
    }
  });
});

describe("projectReconstruction — crime event projection", () => {
  it("always includes exactly one attack event", () => {
    const truth = generateCase(SAFE_SEED, { difficulty: "investigator" });
    const scenario = projectOrThrow(truth);
    expect(scenario.events.filter((e) => e.type === "attack").length).toBe(1);
  });

  it("the attack event's actor is the culprit actor", () => {
    const truth = generateCase(SAFE_SEED, { difficulty: "investigator" });
    const scenario = projectOrThrow(truth);
    const attackEvent = scenario.events.find((e) => e.type === "attack")!;
    const culpritActor = scenario.actors.find((a) => a.roleForReconstruction === "culprit")!;
    expect(attackEvent.actorVisualId).toBe(culpritActor.visualId);
  });

  it("the attack event's counterparty is the victim actor when a victim actor exists", () => {
    const truth = generateCase(SAFE_SEED, { difficulty: "investigator" });
    const scenario = projectOrThrow(truth);
    const attackEvent = scenario.events.find((e) => e.type === "attack")!;
    const victimActor = scenario.actors.find((a) => a.roleForReconstruction === "victim");
    if (victimActor) expect(attackEvent.counterpartyVisualId).toBe(victimActor.visualId);
  });

  it("the attack event carries a method-derived safeVisualAction and never a raw method string", () => {
    const truth = generateCase(SAFE_SEED, { difficulty: "investigator" });
    const scenario = projectOrThrow(truth);
    const attackEvent = scenario.events.find((e) => e.type === "attack")!;
    expect(attackEvent.safeVisualAction).toMatch(/^attack_/);
    expect(attackEvent.safeVisualAction).not.toBe(truth.method);
  });
});

describe("projectReconstruction — staging handling", () => {
  it("projects a generic manipulate_scene action when staged, and omits stage_scene entirely when not", () => {
    for (let i = 0; i < 40; i++) {
      const truth = generateCase(`CASE-F${i.toString().padStart(5, "0")}`, { difficulty: "investigator" });
      const scenario = projectOrThrow(truth);
      const stageEvent = scenario.events.find((e) => e.type === "stage_scene");
      if (truth.staging.staged) {
        if (stageEvent) {
          expect(stageEvent.safeVisualAction).toBe("manipulate_scene");
          expect(JSON.stringify(scenario)).not.toContain(truth.staging.description);
        }
      } else {
        expect(stageEvent).toBeUndefined();
      }
    }
  });
});

describe("projectReconstruction — discovery temporal separation", () => {
  it("the discover event, when present, is strictly after the attack event", () => {
    for (let i = 0; i < 15; i++) {
      const truth = generateCase(`CASE-G${i.toString().padStart(5, "0")}`, { difficulty: "investigator" });
      const scenario = projectOrThrow(truth);
      const attackEvent = scenario.events.find((e) => e.type === "attack")!;
      const discoverEvent = scenario.events.find((e) => e.type === "discover");
      if (discoverEvent) expect(discoverEvent.time).toBeGreaterThan(attackEvent.time);
    }
  });

  it("a discoverer who only appears at the discover event never appears in the attack event's presence", () => {
    const truth = generateCase(SAFE_SEED, { difficulty: "investigator" });
    const scenario = projectOrThrow(truth);
    const discoverEvent = scenario.events.find((e) => e.type === "discover");
    const attackEvent = scenario.events.find((e) => e.type === "attack")!;
    if (!discoverEvent) return;
    if (discoverEvent.actorVisualId === attackEvent.actorVisualId || discoverEvent.actorVisualId === attackEvent.counterpartyVisualId) return;
    // The discoverer is a third party — confirm they never spawn before the attack ends.
    const discovererActor = scenario.actors.find((a) => a.visualId === discoverEvent.actorVisualId)!;
    expect(discovererActor.spawnTime).toBeGreaterThanOrEqual(attackEvent.time);
  });
});

describe("projectReconstruction — timeline normalization and ordering", () => {
  it("normalizes the earliest included event to t=0", () => {
    const truth = generateCase(SAFE_SEED, { difficulty: "investigator" });
    const scenario = projectOrThrow(truth);
    const minTime = Math.min(...scenario.events.map((e) => e.time));
    expect(minTime).toBe(0);
  });

  it("never produces a negative timestamp", () => {
    for (let i = 0; i < 15; i++) {
      const truth = generateCase(`CASE-H${i.toString().padStart(5, "0")}`, { difficulty: "investigator" });
      const scenario = projectOrThrow(truth);
      for (const event of scenario.events) expect(event.time).toBeGreaterThanOrEqual(0);
      for (const actor of scenario.actors) {
        expect(actor.spawnTime).toBeGreaterThanOrEqual(0);
        expect(actor.despawnTime).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("never produces an event time beyond durationSeconds", () => {
    for (let i = 0; i < 15; i++) {
      const truth = generateCase(`CASE-I${i.toString().padStart(5, "0")}`, { difficulty: "investigator" });
      const scenario = projectOrThrow(truth);
      for (const event of scenario.events) expect(event.time).toBeLessThanOrEqual(scenario.durationSeconds);
    }
  });

  it("events array is sorted by time ascending", () => {
    const truth = generateCase(SAFE_SEED, { difficulty: "investigator" });
    const scenario = projectOrThrow(truth);
    for (let i = 1; i < scenario.events.length; i++) {
      expect(scenario.events[i].time).toBeGreaterThanOrEqual(scenario.events[i - 1].time);
    }
  });

  it("uses seconds, never raw GameMinutes values, for a case with a large crimeTimestamp", () => {
    const truth = generateCase(SAFE_SEED, { difficulty: "investigator" });
    const scenario = projectOrThrow(truth);
    // durationSeconds must be a multiple of 60 (derived from minute-resolution GameMinutes).
    expect(scenario.durationSeconds % 60).toBe(0);
  });
});

describe("projectReconstruction — spawn/despawn correctness", () => {
  it("every actor's spawnTime is less than or equal to their despawnTime", () => {
    for (let i = 0; i < 15; i++) {
      const truth = generateCase(`CASE-J${i.toString().padStart(5, "0")}`, { difficulty: "investigator" });
      const scenario = projectOrThrow(truth);
      for (const actor of scenario.actors) {
        expect(actor.spawnTime).toBeLessThanOrEqual(actor.despawnTime);
      }
    }
  });

  it("every actor's first waypoint time equals their spawnTime", () => {
    const truth = generateCase(SAFE_SEED, { difficulty: "investigator" });
    const scenario = projectOrThrow(truth);
    for (const actor of scenario.actors) {
      expect(actor.waypoints[0].time).toBe(actor.spawnTime);
    }
  });

  it("no actor has an empty waypoint list", () => {
    for (let i = 0; i < 15; i++) {
      const truth = generateCase(`CASE-K${i.toString().padStart(5, "0")}`, { difficulty: "investigator" });
      const scenario = projectOrThrow(truth);
      for (const actor of scenario.actors) expect(actor.waypoints.length).toBeGreaterThan(0);
    }
  });
});

describe("projectReconstruction — actor set is never empty", () => {
  it("always produces at least one actor (the culprit)", () => {
    for (let i = 0; i < 15; i++) {
      const truth = generateCase(`CASE-L${i.toString().padStart(5, "0")}`, { difficulty: "investigator" });
      const scenario = projectOrThrow(truth);
      expect(scenario.actors.length).toBeGreaterThan(0);
    }
  });
});

describe("projectReconstruction — visual id references are always valid", () => {
  it("every actorVisualId/counterpartyVisualId in events resolves to a real actor", () => {
    for (let i = 0; i < 15; i++) {
      const truth = generateCase(`CASE-M${i.toString().padStart(5, "0")}`, { difficulty: "investigator" });
      const scenario = projectOrThrow(truth);
      const visualIds = new Set(scenario.actors.map((a) => a.visualId));
      for (const event of scenario.events) {
        expect(visualIds.has(event.actorVisualId)).toBe(true);
        if (event.counterpartyVisualId) expect(visualIds.has(event.counterpartyVisualId)).toBe(true);
      }
    }
  });

  it("no two actors ever share the same visualId", () => {
    for (let i = 0; i < 15; i++) {
      const truth = generateCase(`CASE-N${i.toString().padStart(5, "0")}`, { difficulty: "investigator" });
      const scenario = projectOrThrow(truth);
      const ids = scenario.actors.map((a) => a.visualId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe("projectReconstruction — POC case", () => {
  it("the recommended U5.0 §25 POC case projects to a simple, valid, two-actor scenario", () => {
    const match = findPocCase();
    expect(match).not.toBeNull();
    if (!match) return;
    const scenario = projectOrThrow(match.truth, "poc-case-id");
    expect(scenario.actors.length).toBeGreaterThanOrEqual(1);
    expect(scenario.actors.length).toBeLessThanOrEqual(3); // culprit, victim, at most an unnamed discoverer
    expect(scenario.actors.filter((a) => a.roleForReconstruction === "accomplice").length).toBe(0);
    expect(scenario.events.some((e) => e.type === "stage_scene")).toBe(false);
    const attackEvent = scenario.events.find((e) => e.type === "attack")!;
    expect(attackEvent.safeVisualAction).toMatch(/attack_strike|attack_strangle/);
  });
});
