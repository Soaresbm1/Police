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

export interface AccusedAccomplice {
  personId: PersonId;
  /** Free-form on the wire (an AccompliceRole value, or "" if the player
   * named someone but didn't venture a role) — kept as a string here so an
   * old persisted accusation never fails to deserialize if the engine's
   * role list changes later. */
  role: string;
}

export interface Accusation {
  culpritId: PersonId;
  motiveType: string;
  method: string;
  /** Optional: nobody, one, or several. Never required — a player who
   * never suspected an accomplice can still submit a plain accusation. */
  accomplices: AccusedAccomplice[];
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
  /**
   * @internal The real, deterministic decision — computed and stored the
   * instant the mandate is requested (it only depends on evidence already
   * discovered), but it is NOT player-visible until the matching
   * `bank_warrant`/`search_warrant` InvestigationEvent resolves to
   * `"ready"`. Never read this field directly outside
   * `lib/game-session/mandates.ts`/`persistence/*` — every player-facing
   * caller must go through `mandates.ts#describeMandateEvent` (or
   * `player-view.ts#getMandateOverview`, which already does). Enforced by
   * an eslint `no-restricted-syntax` rule in `eslint.config.mjs` — reading
   * `.granted` anywhere else is a lint error, not just a convention.
   */
  granted: boolean;
  reason: string;
  requestedAt: GameMinutes;
}

/** Phase 1 + Phase 2 + Phase 3 event types — deliberately not exhaustive of
 * every future source (a deeper vehicle-records workflow is NOT built yet,
 * see `lib/game-session/events.ts`). */
export type InvestigationEventType =
  | "lab_result"
  | "bank_warrant"
  | "bank_records"
  | "search_warrant"
  | "cctv_footage"
  | "phone_records"
  | "witness_callback";

export type InvestigationEventStatus = "scheduled" | "ready" | "seen";

/** What this event is about — enough to route a click and to derive a
 * deterministic event id, never a hidden CaseTruth fact id. `"location"`/
 * `"person"` (Phase 2) key CCTV/phone requests by the location or person
 * they're about — never by an evidence id, so the id itself never names
 * the thing being investigated. */
export interface InvestigationEventSource {
  kind: "evidence" | "mandate" | "location" | "person";
  id: string;
}

/**
 * A deterministically-scheduled piece of investigation news. `id` is
 * derived purely from `type`+`source` (see `events.ts#makeEventId`) — no
 * random UUIDs — so the same case+actions always produce the same event
 * ids, and re-requesting the same thing never schedules a duplicate.
 *
 * `payload` is player-safe, pre-rendered text ONLY (see `events.ts`'s
 * callers) — never a raw Evidence/Testimony/MandateRecord object, and
 * never wording that reveals the eventual outcome before `status` reaches
 * `"ready"`.
 */
export interface InvestigationEvent {
  id: string;
  type: InvestigationEventType;
  source: InvestigationEventSource;
  createdAt: GameMinutes;
  scheduledAt: GameMinutes;
  status: InvestigationEventStatus;
  payload: { title: string; detail: string };
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
  /** Deterministic investigation-event schedule (Living Investigation
   * System, Phase 1) — see `events.ts`. Absent/null on any session
   * persisted before this field existed; every reader must treat that as
   * `[]` (see `persistence/supabase-store.ts#rowToSession`). */
  events: InvestigationEvent[];
  notes: string;
  playerTimeline: PlayerTimelineEntry[];
  /** personId -> set of KnowledgeFact ids the player has asked about. */
  interrogated: Record<string, string[]>;
  mandates: Record<string, MandateRecord>;
  board: BoardState;
  accusation: Accusation | null;
  crimeSceneExamined: boolean;
  /** Ids of decoy (evidence-less) crime-scene hotspots the player has
   * already inspected, so the scene screen can show them as "checked"
   * without needing a fake Evidence record to hang that state off of. */
  crimeSceneInspectedZoneIds: string[];
  /** Ids of evidence revealed by the most recently-run action, for a
   * one-shot "you found something" message. Cleared on next read. */
  lastRevealedEvidenceIds: string[];
  lastActionMessage: string | null;
}
