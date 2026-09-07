import { cookies } from "next/headers";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const ANON_PLAYER_COOKIE = "caseline_player";

export interface CurrentIdentity {
  /** Stable id used as the primary key into `SessionStore` — a Supabase
   * `auth.uid()` when configured, otherwise a random id assigned by
   * `middleware.ts` and carried in a plain cookie for local/dev play. */
  userId: string;
  /** False only when Supabase is configured and nobody is signed in —
   * callers should send the player to `/login` rather than treat this as
   * "no active case". In dev-fallback mode this is always true, matching
   * the pre-Phase-9 anonymous-play behavior. */
  authenticated: boolean;
  displayEmail: string | null;
}

/** Resolves who's playing, without touching any game/session data itself.
 * Every Server Component/Action that needs a userId should call this
 * first (see `lib/game-session/current.ts` and `with-session.ts`).
 *
 * Deliberately never *writes* the anonymous cookie here: cookies can only
 * be mutated from middleware, a Server Action, or a Route Handler, never
 * from a plain render — `middleware.ts` is what actually assigns it, on
 * every request, before any Server Component runs. */
export async function getCurrentIdentity(): Promise<CurrentIdentity> {
  if (isSupabaseConfigured()) {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { userId: "", authenticated: false, displayEmail: null };
    return { userId: user.id, authenticated: true, displayEmail: user.email ?? null };
  }

  const jar = await cookies();
  const id = jar.get(ANON_PLAYER_COOKIE)?.value;
  // Should always be set by middleware.ts by the time a request reaches
  // here; the empty-string fallback only matters for tooling that renders
  // outside the normal request/middleware pipeline (e.g. some test setups).
  return { userId: id ?? "", authenticated: Boolean(id), displayEmail: null };
}
