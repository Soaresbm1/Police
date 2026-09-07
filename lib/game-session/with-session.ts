import { generateCase } from "@/lib/game-engine/case-generator/case-truth";
import type { CaseTruth } from "@/lib/game-engine/types/case";
import { getCurrentIdentity } from "./identity";
import { getStore } from "./persistence";
import type { GameSession } from "./types";

export interface SessionContext {
  session: GameSession;
  truth: CaseTruth;
  userId: string;
}

/**
 * Fetches the current player's active session + regenerated truth, runs
 * `fn` against them (which may mutate `session` in place, exactly like
 * every action did before Phase 9), then persists whatever `fn` left
 * behind through the active `SessionStore` — Supabase or the in-memory
 * fallback — before returning `fn`'s result.
 *
 * Centralizing the save here means every mutating action (including the
 * evidence-board ones, which deliberately skip `revalidatePath`) gets
 * persisted the same way without any call site having to remember to do
 * it itself.
 */
export async function withSession<T>(fn: (ctx: SessionContext) => Promise<T> | T): Promise<T> {
  const { userId, authenticated } = await getCurrentIdentity();
  if (!authenticated) throw new Error("Non authentifié.");
  const store = getStore();
  const session = await store.getActiveSession(userId);
  if (!session) throw new Error("Aucune enquête en cours.");
  const truth = generateCase(session.seed, { difficulty: session.difficulty });
  const result = await fn({ session, truth, userId });
  await store.saveSession(userId, session);
  return result;
}
