import type { Difficulty } from "@/lib/game-engine/types/case";
import type { GameSession } from "./types";

/**
 * In-memory session store. This is a deliberate, documented placeholder for
 * Phase 9 (Supabase-backed persistence, see DATABASE.md): sessions live only
 * as long as this Node process, keyed by a cookie-carried id. CaseTruth
 * itself is never stored here — it's cheap and deterministic to regenerate
 * from `session.seed` on every request (see game-session/player-view.ts),
 * so only small, mutable play state needs to live in this store.
 */
const sessions = new Map<string, GameSession>();

function randomSessionId(): string {
  return `sess_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

export function createSession(seed: string, difficulty: Difficulty, crimeTimestamp: number): GameSession {
  const id = randomSessionId();
  const session: GameSession = {
    id,
    seed,
    difficulty,
    createdAt: Date.now(),
    // The investigation begins once the body is discovered; the case's own
    // caseOpenedAt isn't known until generation, so callers pass it in.
    currentTime: crimeTimestamp,
    evidenceStatus: {},
    labQueue: [],
    notes: "",
    playerTimeline: [],
    interrogated: {},
    mandates: {},
    board: { nodes: [], edges: [] },
    accusation: null,
    crimeSceneExamined: false,
    lastRevealedEvidenceIds: [],
    lastActionMessage: null,
  };
  sessions.set(id, session);
  return session;
}

export function getSession(id: string | undefined): GameSession | undefined {
  if (!id) return undefined;
  return sessions.get(id);
}

export function deleteSession(id: string): void {
  sessions.delete(id);
}
