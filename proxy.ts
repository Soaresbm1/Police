import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isSupabaseConfigured } from "@/lib/supabase/config";

const ANON_PLAYER_COOKIE = "caseline_player";

function randomAnonId(): string {
  return `anon_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

/**
 * Two unrelated jobs, both required to run before any Server Component
 * renders (cookies can only be *written* from Proxy, a Server Action, or a
 * Route Handler — never from a plain render, which is exactly the "Cookies
 * can only be modified..." error this file exists to avoid):
 *
 * 1. Supabase mode: refreshes the auth session cookie, per Supabase's own
 *    SSR guidance — without this a signed-in player's session would
 *    silently expire mid-investigation.
 * 2. Dev-fallback mode (no Supabase configured): assigns the anonymous
 *    player id cookie `getCurrentIdentity()` reads, so first-visit
 *    Server Components never need to write it themselves.
 *
 * In both branches the request's own cookie jar is mutated *before*
 * `NextResponse.next({ request })` is constructed — that call snapshots the
 * request to forward downstream, so setting cookies on it afterwards would
 * never reach the Server Component render for this same request.
 *
 * Named `proxy` per this Next.js version's file convention (the
 * `middleware.ts`/`export function middleware` names are deprecated as of
 * v16 — see node_modules/next/dist/docs/.../file-conventions/proxy.md).
 */
export async function proxy(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    if (!request.cookies.get(ANON_PLAYER_COOKIE)) {
      const id = randomAnonId();
      request.cookies.set(ANON_PLAYER_COOKIE, id);
      const response = NextResponse.next({ request });
      response.cookies.set(ANON_PLAYER_COOKIE, id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
      return response;
    }
    return NextResponse.next({ request });
  }

  const response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  try {
    await supabase.auth.getUser();
  } catch {
    // Best-effort session refresh — a transient network failure reaching
    // Supabase here must never take down the whole request (or, worse,
    // the dev server process), since Proxy runs ahead of every route.
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
