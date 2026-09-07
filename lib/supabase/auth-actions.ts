"use server";

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "./server";
import { isSupabaseConfigured } from "./config";

export async function signOutAction() {
  if (isSupabaseConfigured()) {
    const supabase = await createServerSupabaseClient();
    await supabase.auth.signOut();
  }
  redirect("/");
}
