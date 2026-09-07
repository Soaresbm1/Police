import { generateCase } from "@/lib/game-engine/case-generator/case-truth";
import type { CaseTruth } from "@/lib/game-engine/types/case";
import { getStore } from "./persistence";
import { getCurrentIdentity } from "./identity";
import type { GameSession } from "./types";

export interface ActiveGame {
  session: GameSession;
  truth: CaseTruth;
  userId: string;
}

/** Read-only accessor for Server Components: resolves the current player
 * and regenerates their active case's CaseTruth (cheap, deterministic —
 * see ARCHITECTURE.md#determinism) rather than storing it anywhere. Returns
 * null both when nobody is signed in (Supabase mode) and when the player
 * has no active case — callers already treat both as "show the menu". */
export async function getCurrentGame(): Promise<ActiveGame | null> {
  const { userId, authenticated } = await getCurrentIdentity();
  if (!authenticated) return null;
  const session = await getStore().getActiveSession(userId);
  if (!session) return null;
  const truth = generateCase(session.seed, { difficulty: session.difficulty });
  return { session, truth, userId };
}
