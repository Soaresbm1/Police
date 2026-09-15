import { describe, expect, it } from "vitest";
import {
  deriveActorVisualId,
  deriveGenericAppearance,
  mapLocationTypeToEnvironment,
  slotForEventType,
} from "../reconstruction-layout";
import type { LocationType } from "../../types/location";
import type { ReconstructionEventType } from "../reconstruction-types";

describe("reconstruction-layout", () => {
  describe("deriveActorVisualId", () => {
    it("is deterministic: same caseId+personId always yields the same id", () => {
      const a = deriveActorVisualId("case-123", "person-abc");
      const b = deriveActorVisualId("case-123", "person-abc");
      expect(a).toBe(b);
    });

    it("gives different people different ids within the same case", () => {
      const a = deriveActorVisualId("case-123", "person-abc");
      const b = deriveActorVisualId("case-123", "person-xyz");
      expect(a).not.toBe(b);
    });

    it("gives the same person different ids across different cases", () => {
      const a = deriveActorVisualId("case-123", "person-abc");
      const b = deriveActorVisualId("case-999", "person-abc");
      expect(a).not.toBe(b);
    });

    it("never contains the raw personId as a substring", () => {
      const personId = "p_verylongdistinctivepersonidentifier";
      const id = deriveActorVisualId("case-1", personId);
      expect(id).not.toContain(personId);
    });

    it("starts with the actor_ prefix and no other identifying text", () => {
      const id = deriveActorVisualId("case-1", "p_1");
      expect(id).toMatch(/^actor_[a-z0-9]+$/);
    });
  });

  describe("deriveGenericAppearance", () => {
    it("is deterministic per (caseId, personId)", () => {
      const a = deriveGenericAppearance("case-1", "p_1");
      const b = deriveGenericAppearance("case-1", "p_1");
      expect(a).toBe(b);
    });

    it("comes from a small closed vocabulary, not free text", () => {
      const appearance = deriveGenericAppearance("case-1", "p_1");
      expect(appearance).toMatch(/^(casual|formal|workwear|outerwear)_(dark|light|neutral)$/);
    });

    it("never contains the raw personId", () => {
      const personId = "p_verylongdistinctivepersonidentifier";
      const appearance = deriveGenericAppearance("case-1", personId);
      expect(appearance).not.toContain(personId);
    });
  });

  describe("mapLocationTypeToEnvironment", () => {
    it("maps every LocationType to a defined environment kind", () => {
      const allTypes: LocationType[] = [
        "police_station",
        "apartment",
        "house",
        "restaurant",
        "bar",
        "office",
        "parking",
        "bank",
        "pharmacy",
        "hospital",
        "train_station",
        "gas_station",
        "shop",
        "hotel",
        "park",
        "warehouse",
      ];
      for (const type of allTypes) {
        const env = mapLocationTypeToEnvironment(type);
        expect(["corridor", "parking", "shop", "street", "generic"]).toContain(env);
      }
    });

    it("is deterministic", () => {
      expect(mapLocationTypeToEnvironment("shop")).toBe(mapLocationTypeToEnvironment("shop"));
    });
  });

  describe("slotForEventType", () => {
    it("maps every ReconstructionEventType to a defined slot", () => {
      const allTypes: ReconstructionEventType[] = [
        "meet",
        "talk",
        "attack",
        "phone_use",
        "leave_scene",
        "use_object",
        "discover",
        "stage_scene",
      ];
      for (const type of allTypes) {
        const slot = slotForEventType(type);
        expect(["entrance", "interaction", "crime_point", "interior_center", "exit"]).toContain(slot);
      }
    });

    it("maps attack and discover to the same crime_point slot", () => {
      expect(slotForEventType("attack")).toBe("crime_point");
      expect(slotForEventType("discover")).toBe("crime_point");
    });

    it("maps leave_scene to exit", () => {
      expect(slotForEventType("leave_scene")).toBe("exit");
    });
  });
});
