import { describe, expect, it } from "vitest";
import { generateCase } from "@/lib/game-engine/case-generator/case-truth";
import { getMapLocations, getVisibleEvidence } from "../player-view";
import type { GameSession } from "../types";

function makeSession(seed: string, evidenceStatus: GameSession["evidenceStatus"] = {}): GameSession {
  return {
    id: "s1",
    seed,
    difficulty: "investigator",
    createdAt: Date.now(),
    currentTime: 0,
    evidenceStatus,
    labQueue: [],
    events: [],
    notes: "",
    playerTimeline: [],
    interrogated: {},
    mandates: {},
    surveillance: {},
    board: { nodes: [], edges: [] },
    accusation: null,
    crimeSceneExamined: false,
    crimeSceneInspectedZoneIds: [],
    lastRevealedEvidenceIds: [],
    lastActionMessage: null,
  };
}

describe("getMapLocations", () => {
  it("never shows a location whose only significance is undiscovered evidence", () => {
    const truth = generateCase("CASE-MAPTEST1", { difficulty: "investigator" });
    // Nothing discovered yet.
    const session = makeSession(truth.seed);
    const locations = getMapLocations(truth, session);
    const shownIds = new Set(locations.map((l) => l.id));

    // Homes/workplaces/crime scene are always public-safe; anything else
    // referenced only by undiscovered evidence must be absent.
    const alwaysVisible = new Set<string>([truth.crimeLocationId]);
    for (const p of truth.people) {
      alwaysVisible.add(p.homeLocationId);
      if (p.workLocationId) alwaysVisible.add(p.workLocationId);
    }
    for (const loc of truth.locations) {
      if (!shownIds.has(loc.id)) continue;
      const referencedByUndiscoveredOnly =
        !alwaysVisible.has(loc.id) &&
        truth.evidence.some((ev) => ev.relatedLocationIds.includes(loc.id)) &&
        !getVisibleEvidence(truth, session).some((ev) => ev.relatedLocationIds.includes(loc.id));
      expect(referencedByUndiscoveredOnly).toBe(false);
    }
  });

  it("only counts discoveredEventTimestamps for evidence the player has actually found", () => {
    const truth = generateCase("CASE-MAPTEST2", { difficulty: "investigator" });
    const firstEvidence = truth.evidence[0];
    const session = makeSession(truth.seed, { [firstEvidence.id]: "discovered" });
    const locations = getMapLocations(truth, session);
    const totalTimestamps = locations.reduce((sum, l) => sum + l.discoveredEventTimestamps.length, 0);
    expect(totalTimestamps).toBeGreaterThan(0);
    expect(totalTimestamps).toBeLessThanOrEqual(firstEvidence.relatedLocationIds.length);
  });
});
