import "server-only";

/**
 * Security S2 — the narrow server-only capability that lets
 * `SupabaseSessionStore.finalizeCase()` call the database's
 * `caseline_finalize_case` function with an authoritative result
 * (score/grade/XP) rather than only a semantic player action.
 *
 * `CASELINE_S2_SERVER_CAPABILITY` is a server-only Vercel environment
 * variable (never `NEXT_PUBLIC_`), independent from
 * `CASELINE_S1_MASTER_SECRET` — S1 protects seed confidentiality, this
 * authorizes privileged authoritative mutations; the two trust domains
 * stay separate on purpose. Its value is read only here, only inside
 * server-side code, and is never logged, returned to a caller, or
 * embedded in any structure a Client Component could receive.
 *
 * The database never sees this module or the raw value described above
 * outside of the one RPC argument it's passed as — it stores only a
 * SHA-256 verifier of it (see supabase/migrations/0007_…, and
 * SECURITY.md §S2).
 */

const ENV_VAR = "CASELINE_S2_SERVER_CAPABILITY";
const MIN_LENGTH = 32;

export class S2CapabilityConfigError extends Error {
  constructor() {
    super(`[CASELINE] [S2] ${ENV_VAR} is not configured — refusing to finalize a case authoritatively.`);
    this.name = "S2CapabilityConfigError";
  }
}

/** Throws rather than ever falling back to "skip the capability check" —
 * a missing/too-short value fails the call closed, matching the database
 * function's own `length(p_token) < 32` guard. */
export function getS2ServerCapabilityToken(): string {
  const raw = process.env[ENV_VAR];
  if (!raw || raw.trim().length < MIN_LENGTH) throw new S2CapabilityConfigError();
  return raw;
}
