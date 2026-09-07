import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "./database.types";

/**
 * A Supabase client bound to the current request's cookies, for use in
 * Server Components, Server Actions, and Route Handlers. Every query it
 * runs is subject to Postgres RLS as the signed-in user (see
 * `supabase/migrations/`) — there is no service-role/bypass client anywhere
 * in this codebase, deliberately, so a bug here can leak at most what RLS
 * already allows that user to see (their own rows, never another
 * player's, never a raw CaseTruth column — there isn't one).
 */
export async function createServerSupabaseClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component with no response to attach
          // cookies to — the middleware refreshes the session instead.
        }
      },
    },
  });
}
