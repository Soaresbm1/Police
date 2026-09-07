import type { Difficulty } from "@/lib/game-engine/types/case";
import type { GameMinutes } from "@/lib/game-engine/types/time";
import type { LabAnalysisType } from "@/lib/game-engine/types/evidence";
import type { PersonId } from "@/lib/game-engine/types/person";
import type { LocationId } from "@/lib/game-engine/types/location";

/**
 * Player-facing evidence lifecycle. This is intentionally separate from
 * `Evidence.status` in the engine: the engine's status is part of the
 * immutable-per-request CaseTruth, while this is mutable play state layered
 * on top for one player's session.
 */
export type EvidencePlayerStatus = "undiscovered" | "discovered" | "collected" | "sent_to_lab" | "analyzed";

export interface LabJob {
  evidenceId: string;
  analysisType: LabAnalysisType;
  submittedAt: GameMinutes;
  readyAt: GameMinutes;
}

export type PlayerTimelineStatus = "confirmed" | "probable" | "hypothesis" | "contested";

export interface PlayerTimelineEntry {
  id: string;
  time: GameMinutes | null;
  description: string;
  personId: PersonId | null;
  status: PlayerTimelineStatus;
  createdAt: number;
}

export interface Accusation {
  culpritId: PersonId;
  motiveType: string;
  method: string;
  submittedAt: GameMinutes;
}

export type MandateSubject = { kind: "search"; locationId: LocationId; personId: PersonId } | { kind: "bank"; personId: PersonId };

export type BoardNodeKind = "person" | "evidence" | "location" | "note";

export interface BoardNode {
  id: string;
  kind: BoardNodeKind;
  /** The underlying person/evidence/location id this node represents;
   * empty for a freeform "note" node. */
  refId: string;
  label: string;
  detail: string;
  x: number;
  y: number;
}

export interface BoardEdge {
  id: string;
  source: string;
  target: string;
  label: string;
}

export interface BoardState {
  nodes: BoardNode[];
  edges: BoardEdge[];
}

export interface MandateRecord {
  key: string;
  granted: boolean;
  reason: string;
  requestedAt: GameMinutes;
}

export interface GameSession {
  id: string;
  seed: string;
  difficulty: Difficulty;
  createdAt: number;
  currentTime: GameMinutes;
  /** Only entries for evidence the player has interacted with; anything
   * absent is implicitly "undiscovered". */
  evidenceStatus: Record<string, EvidencePlayerStatus>;
  labQueue: LabJob[];
  notes: string;
  playerTimeline: PlayerTimelineEntry[];
  /** personId -> set of KnowledgeFact ids the player has asked about. */
  interrogated: Record<string, string[]>;
  mandates: Record<string, MandateRecord>;
  board: BoardState;
  accusation: Accusation | null;
  crimeSceneExamined: boolean;
  /** Ids of evidence revealed by the most recently-run action, for a
   * one-shot "you found something" message. Cleared on next read. */
  lastRevealedEvidenceIds: string[];
  lastActionMessage: string | null;
}
