import type { Evidence, EvidenceReliability } from "@/lib/game-engine/types/evidence";
import type { CaseTruth } from "@/lib/game-engine/types/case";
import type { PersonId } from "@/lib/game-engine/types/person";
import { hashSeed } from "./hash";

export type CCTVVisibilityQuality = "clear" | "partial" | "obstructed" | "low_light" | "distant";

export interface CCTVFrameDescriptor {
  cameraId: string;
  locationId: string;
  timestamp: number;
  visibilityQuality: CCTVVisibilityQuality;
  /** Strictly derived from `visibilityQuality` — never true unless the
   * frame quality genuinely supports recognizing a face or plate. This is
   * the fairness-critical field: nothing downstream may render an
   * identifying detail unless this is true (req. 11). */
  identifiable: boolean;
  /** Only populated when `identifiable` is true — otherwise deliberately
   * empty, so no consumer can leak who was actually present on a frame
   * the evidence itself says was too poor to identify anyone on. */
  visiblePersonIds: PersonId[];
  visibleVehiclePlate: string | null;
}

const QUALITY_BY_RELIABILITY: Record<EvidenceReliability, CCTVVisibilityQuality> = {
  reliable: "clear",
  partial: "partial",
  ambiguous: "obstructed",
  contaminated: "low_light",
  falsified: "distant",
};

const IDENTIFIABLE_QUALITIES: CCTVVisibilityQuality[] = ["clear", "partial"];

/** Derives a camera's visual frame from one `camera_footage`/`dashcam_footage`
 * evidence item. Deterministic — the same evidence id always yields the
 * same frame, matching the underlying `Evidence.reliability` the engine
 * already assigned (never invents a quality tier independently). */
export function buildCCTVFrameDescriptor(evidence: Evidence, truth?: CaseTruth): CCTVFrameDescriptor {
  const locationId = evidence.relatedLocationIds[0] ?? evidence.sourceLocationId ?? "";
  const baseQuality = QUALITY_BY_RELIABILITY[evidence.reliability];
  // A hard-to-find frame is hard to find because of a poor angle or bad
  // timing, not because the evidence's own reliability lied — a high
  // discovery difficulty degrades an otherwise-clear shot by one notch.
  const visibilityQuality: CCTVVisibilityQuality = evidence.discoveryDifficulty > 0.7 && baseQuality === "clear" ? "partial" : baseQuality;
  const identifiable = IDENTIFIABLE_QUALITIES.includes(visibilityQuality);

  const vehicleOwner = identifiable && truth ? truth.people.find((p) => evidence.relatedPersonIds.includes(p.id) && p.vehicle) : undefined;

  return {
    cameraId: `CAM-${hashSeed(locationId).toString(16).slice(0, 4).toUpperCase()}`,
    locationId,
    timestamp: evidence.timestamp,
    visibilityQuality,
    identifiable,
    visiblePersonIds: identifiable ? evidence.relatedPersonIds : [],
    visibleVehiclePlate: vehicleOwner?.vehicle?.plate ?? null,
  };
}
