"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types";

/** Browser-side Supabase client, used only by the sign-in/sign-up form
 * (`components/auth/AuthForm.tsx`) to call `supabase.auth.signInWithPassword`
 * / `signUp` directly — every other read/write in the game goes through a
 * Server Action using `createServerSupabaseClient` instead. */
export function createBrowserSupabaseClient() {
  return createBrowserClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
}
