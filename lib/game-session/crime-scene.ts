import type { CaseTruth } from "@/lib/game-engine/types/case";
import type { GameSession } from "./types";
import { getCrimeSceneEvidence } from "./discovery";
import { evidenceStatusOf } from "./player-view";
import { getZonesForLocation, type SemanticAnchor } from "@/lib/art/crime-scene-layouts";

/** "Le corps" is reserved separately from the room's prop zones — always
 * shown, never gated behind discovery (the body itself isn't a secret).
 * Anchored as "floor": a body is always found lying on the ground. */
const BODY_ZONE = { id: "corps", label: "Le corps", x: 50, y: 58, semanticAnchor: "floor" as const };

const DECOY_LINES = [
  "Rien de particulier ici.",
  "Aucun élément exploitable à première vue.",
  "Examiné — sans intérêt pour l'enquête.",
  "Rien qui ne semble lié à l'affaire.",
];

function hashOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export interface CrimeSceneHotspot {
  zoneId: string;
  zoneNumber: number;
  label: string;
  x: number;
  y: number;
  /** Purely visual classification (see `crime-scene-layouts.ts`) — never
   * read by evidence/discovery logic, only by `lib/art/hotspot-layout.ts`. */
  semanticAnchor: SemanticAnchor;
  kind: "body" | "evidence" | "decoy";
  evidenceId: string | null;
  discovered: boolean;
  /** Only populated once `discovered` is true. */
  evidenceDescription: string | null;
  evidenceType: string | null;
  decoyLine: string | null;
}

/** Deterministically lays the crime scene's discoverable evidence out across
 * a small fixed set of room "zones" so the player explores the scene
 * hotspot by hotspot instead of one bulk "examine" button. The underlying
 * discoverable set is unchanged from `discovery.getCrimeSceneEvidence` —
 * this only decides which zone each item appears under and where decoys go. */
export function getCrimeSceneHotspots(truth: CaseTruth, session: GameSession): CrimeSceneHotspot[] {
  const crimeLocation = truth.locations.find((l) => l.id === truth.crimeLocationId);
  const propZones = crimeLocation ? getZonesForLocation(crimeLocation.type, `${crimeLocation.id}:${crimeLocation.type}`) : [];
  const evidence = [...getCrimeSceneEvidence(truth)].sort((a, b) => a.id.localeCompare(b.id));
  const freeZones = [...propZones];
  const assignments = new Map<string, (typeof evidence)[number]>();

  for (const ev of evidence) {
    if (freeZones.length === 0) break;
    const index = hashOf(ev.id) % freeZones.length;
    const zone = freeZones.splice(index, 1)[0];
    assignments.set(zone.id, ev);
  }

  const hotspots: CrimeSceneHotspot[] = [
    {
      zoneId: BODY_ZONE.id,
      zoneNumber: 1,
      label: BODY_ZONE.label,
      x: BODY_ZONE.x,
      y: BODY_ZONE.y,
      semanticAnchor: BODY_ZONE.semanticAnchor,
      kind: "body",
      evidenceId: null,
      discovered: true,
      evidenceDescription: null,
      evidenceType: null,
      decoyLine: null,
    },
  ];

  propZones.forEach((zone, i) => {
    const ev = assignments.get(zone.id);
    const zoneNumber = i + 2;
    if (ev) {
      const discovered = evidenceStatusOf(session, ev.id) !== "undiscovered";
      hotspots.push({
        zoneId: zone.id,
        zoneNumber,
        label: zone.label,
        x: zone.x,
        y: zone.y,
        semanticAnchor: zone.semanticAnchor,
        kind: "evidence",
        evidenceId: ev.id,
        discovered,
        evidenceDescription: discovered ? ev.description : null,
        evidenceType: discovered ? ev.type : null,
        decoyLine: null,
      });
    } else {
      const inspected = session.crimeSceneInspectedZoneIds.includes(zone.id);
      hotspots.push({
        zoneId: zone.id,
        zoneNumber,
        label: zone.label,
        x: zone.x,
        y: zone.y,
        semanticAnchor: zone.semanticAnchor,
        kind: "decoy",
        evidenceId: null,
        discovered: inspected,
        evidenceDescription: null,
        evidenceType: null,
        decoyLine: inspected ? DECOY_LINES[hashOf(zone.id) % DECOY_LINES.length] : null,
      });
    }
  });

  return hotspots;
}
