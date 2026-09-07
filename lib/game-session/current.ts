import { cookies } from "next/headers";
import { generateCase } from "@/lib/game-engine/case-generator/case-truth";
import type { CaseTruth } from "@/lib/game-engine/types/case";
import { getSession } from "./store";
import type { GameSession } from "./types";

export const SESSION_COOKIE = "caseline_session";

export interface ActiveGame {
  session: GameSession;
  truth: CaseTruth;
}

/** Read-only accessor for Server Components: resolves the cookie-carried
 * session id and regenerates that session's CaseTruth (cheap, deterministic
 * — see ARCHITECTURE.md#determinism) rather than storing it anywhere. */
export async function getCurrentGame(): Promise<ActiveGame | null> {
  const jar = await cookies();
  const id = jar.get(SESSION_COOKIE)?.value;
  const session = getSession(id);
  if (!session) return null;
  const truth = generateCase(session.seed, { difficulty: session.difficulty });
  return { session, truth };
}
