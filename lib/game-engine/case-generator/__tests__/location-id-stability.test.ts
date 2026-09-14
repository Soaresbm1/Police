import { describe, expect, it } from "vitest";
import { generateCase } from "../case-truth";
import { getCameraEquippedLocations } from "@/lib/game-session/player-view";

/**
 * Phase U3.7 — location id stability audit (mirrors the historical evidence
 * id audit at lib/game-engine/evidence/__tests__/evidence-id-stability.test.ts,
 * whose root cause — `RNG.id()` deriving from a shared, mutable
 * `callCount` — is the same class of bug this file guards against for
 * `Location.id`, see world-generator.ts#generateTownInfrastructure).
 *
 * This audit found `generateCase` IS deterministic per seed for locations
 * (tests below confirm it directly) — the "Lieu inconnu" / crash symptom
 * reported from the Vercel Preview was traced instead to session identity
 * churn under `MemoryStore` (see with-session.ts — state lost between
 * serverless invocations, throwing "Aucune enquête en cours." on the next
 * server action) combined with `CamerasApp` holding a stale `locationId`
 * across that churn. The fix lives in CamerasApp.tsx
 * (`resolveValidLocationId` + a `useEffect` that self-heals when `locations`
 * changes, plus a try/catch around the search action). These tests instead
 * pin down the piece this file is actually responsible for: that location
 * ids are stable, unique, and that the same lookup `searchCameraAction`
 * performs behaves correctly for both valid and invalid ids.
 */
const RUN_FULL = process.env.RUN_LOCATION_ID_STATS === "1";
const CASE_COUNT = RUN_FULL ? 2000 : 60;

describe("location id stability — historical-case compatibility (req. 1/2)", () => {
  it("same seed, regenerated twice, yields byte-identical location id lists (order and content)", () => {
    for (let i = 0; i < 15; i++) {
      const seed = `CASE-LOCDETERMINISM-${i}`;
      const a = generateCase(seed, { difficulty: "investigator" });
      const b = generateCase(seed, { difficulty: "investigator" });
      expect(a.locations.map((l) => l.id)).toEqual(b.locations.map((l) => l.id));
    }
  });

  it("same seed, regenerated twice, yields the same camera-equipped locations projection (req. UI stability)", () => {
    for (let i = 0; i < 15; i++) {
      const seed = `CASE-LOCPROJECTION-${i}`;
      const truthA = generateCase(seed, { difficulty: "investigator" });
      const truthB = generateCase(seed, { difficulty: "investigator" });
      expect(getCameraEquippedLocations(truthA)).toEqual(getCameraEquippedLocations(truthB));
    }
  });

  it("every location id in a freshly generated case is unique", () => {
    for (let i = 0; i < 30; i++) {
      const truth = generateCase(`CASE-LOCIDCHECK-${i}`, { difficulty: "investigator" });
      const ids = truth.locations.map((l) => l.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("a valid, currently-generated location id resolves to a real, camera-equipped location (matches searchCameraAction's own lookup)", () => {
    for (let i = 0; i < 20; i++) {
      const truth = generateCase(`CASE-LOCLOOKUP-${i}`, { difficulty: "investigator" });
      const cameraLocations = truth.locations.filter((l) => l.hasCameras);
      for (const loc of cameraLocations) {
        const found = truth.locations.find((l) => l.id === loc.id);
        expect(found).toBeDefined();
        expect(found!.hasCameras).toBe(true);
      }
    }
  });

  it("an unknown/tampered location id is safely rejected (not found, not thrown) — the exact lookup searchCameraAction performs", () => {
    const truth = generateCase("CASE-LOCTAMPER-01", { difficulty: "investigator" });
    const tamperedIds = ["loc_doesnotexist", "", "loc_" + "x".repeat(50), "'; DROP TABLE locations;--"];
    for (const tampered of tamperedIds) {
      expect(() => truth.locations.find((l) => l.id === tampered)).not.toThrow();
      expect(truth.locations.find((l) => l.id === tampered)).toBeUndefined();
    }
  });

  it(`stress: across ${CASE_COUNT} generated cases, 0 duplicate/missing/unstable location ids and 0 valid-id lookup failures (run with RUN_LOCATION_ID_STATS=1 for the full 2000-case sweep)`, () => {
    let duplicates = 0;
    let missingIds = 0;
    let lookupFailures = 0;
    let determinismMismatches = 0;

    for (let i = 0; i < CASE_COUNT; i++) {
      const seed = `CASE-LOCSTRESS-${i}`;
      const truth = generateCase(seed, { difficulty: "investigator" });

      const ids = truth.locations.map((l) => l.id);
      if (new Set(ids).size !== ids.length) duplicates++;
      if (ids.some((id) => !id)) missingIds++;

      for (const loc of truth.locations) {
        if (truth.locations.find((l) => l.id === loc.id) !== loc) lookupFailures++;
      }

      const regenerated = generateCase(seed, { difficulty: "investigator" });
      if (JSON.stringify(regenerated.locations.map((l) => l.id)) !== JSON.stringify(ids)) determinismMismatches++;
    }

    expect(duplicates).toBe(0);
    expect(missingIds).toBe(0);
    expect(lookupFailures).toBe(0);
    expect(determinismMismatches).toBe(0);
  }, 30_000);
});
