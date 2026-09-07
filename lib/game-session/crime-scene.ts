import type { CaseTruth } from "@/lib/game-engine/types/case";
import type { GameSession } from "./types";
import { getCrimeSceneEvidence } from "./discovery";
import { evidenceStatusOf } from "./player-view";

/** Fixed pool of generic room props a homicide scene plausibly contains.
 * "Le corps" is reserved separately (always shown, never gated behind
 * discovery — the body itself isn't a secret). The other seven are filled
 * with real evidence first; any left over become flavor-only decoys, so a
 * sparse case doesn't feel like an obviously empty room. */
const BODY_ZONE = { id: "corps", label: "Le corps", x: 50, y: 58 };

const PROP_ZONES: { id: string; label: string; x: number; y: number }[] = [
  { id: "table", label: "Table basse", x: 28, y: 68 },
  { id: "fenetre", label: "Fenêtre", x: 82, y: 18 },
  { id: "porte", label: "Porte d'entrée", x: 14, y: 22 },
  { id: "sol", label: "Sol", x: 62, y: 82 },
  { id: "telephone", label: "Téléphone", x: 72, y: 50 },
  { id: "poubelle", label: "Poubelle", x: 18, y: 78 },
  { id: "armoire", label: "Armoire", x: 86, y: 62 },
];

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
  const evidence = [...getCrimeSceneEvidence(truth)].sort((a, b) => a.id.localeCompare(b.id));
  const freeZones = [...PROP_ZONES];
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
      kind: "body",
      evidenceId: null,
      discovered: true,
      evidenceDescription: null,
      evidenceType: null,
      decoyLine: null,
    },
  ];

  PROP_ZONES.forEach((zone, i) => {
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
