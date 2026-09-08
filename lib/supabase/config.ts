/**
 * Whether real Supabase persistence is configured. Everything in
 * `lib/game-session/persistence` checks this before touching the network —
 * when it's false the game falls back to the in-memory store
 * (`memory-store.ts`) so local development stays fully playable without a
 * Supabase project. See DATABASE.md for exactly which env vars are needed
 * and where to put them.
 */
export function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (Boolean(url) !== Boolean(key)) {
    // Only one of the two is set — almost certainly a copy/paste mistake in
    // .env.local rather than an intentional partial setup. Warn loudly
    // instead of silently limping along in whichever mode this resolves to.
    console.warn(
      "[CASELINE] Configuration Supabase incomplète : NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY " +
        "doivent être définies toutes les deux, ou aucune des deux. Retour au stockage local en mémoire pour l'instant.",
    );
    return false;
  }

  return Boolean(url && key);
}
