import "server-only";

import { createClient } from "@supabase/supabase-js";
import { isCaseRef } from "@/lib/security/case-ref";
import { isLegacyCaseSeed } from "@/lib/game-engine/random/rng";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Security S2 EXPAND-2 — the ONE place in this codebase permitted to hold a
 * Supabase `service_role` credential, and ONLY for `generated-art` Storage
 * object writes. Every other piece of trusted server logic (game-state
 * mutations, profile updates, case finalization) uses the SECURITY DEFINER
 * + `CASELINE_S2_SERVER_CAPABILITY` architecture instead (see SECURITY.md
 * §S2) — that pattern cannot solve Storage writes because a PostgreSQL
 * function has no mechanism to elevate a Storage REST call's privilege
 * (object bytes never pass through a SQL function body at all). This is
 * why Storage is the one place a privileged credential is used at all.
 *
 * Hard rules enforced by this module's shape, not just its comments:
 * - Never exported: `getServiceRoleClient()` is NOT exported. No caller,
 *   anywhere, can obtain the raw privileged client — only the narrow
 *   semantic operations below (`uploadGeneratedAsset`, `moveGeneratedAsset`,
 *   `removeGeneratedAsset`) are exported, each scoped to exactly the
 *   `generated-art` bucket and a validated path.
 * - Never used for `investigation_sessions`/`profiles`/`case_history`, or
 *   any table at all — this module calls `.storage` only, never `.from(...)`.
 * - Never used for normal gameplay mutations — those stay on the
 *   capability-token architecture; nothing here is imported by
 *   `lib/game-session/**`.
 * - The raw key is read once, lazily, only inside this file, and is never
 *   logged, returned, serialized, or included in a thrown error message
 *   (`configErrorMessage()` below never interpolates `process.env` values).
 * - `import "server-only"` — Next.js refuses to bundle this module into any
 *   Client Component's graph at build time (see
 *   `lib/generated-art/__tests__/trusted-storage-boundary.test.ts` for the
 *   static proof this repo's build actually enforces that).
 */

const BUCKET = "generated-art" as const;
const SERVICE_ROLE_ENV_VAR = "SUPABASE_SERVICE_ROLE_KEY";

export class TrustedStorageConfigError extends Error {
  constructor() {
    // Deliberately no interpolation of any env value — see the module doc
    // comment's "never included in errors" rule.
    super(`[CASELINE] [S2] ${SERVICE_ROLE_ENV_VAR} is not configured — refusing to perform a trusted Storage operation.`);
    this.name = "TrustedStorageConfigError";
  }
}

export class TrustedStoragePathError extends Error {
  constructor(reason: string) {
    super(`[CASELINE] [S2] rejected trusted Storage path: ${reason}`);
    this.name = "TrustedStoragePathError";
  }
}

type ServiceRoleClient = ReturnType<typeof createClient<Database>>;

let cachedClient: ServiceRoleClient | null = null;

/** NOT exported — see the module doc comment. Constructed lazily so that
 * merely importing this module (or calling a function that doesn't yet
 * need it) never requires the secret to exist. */
function getServiceRoleClient(): ServiceRoleClient {
  if (cachedClient) return cachedClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env[SERVICE_ROLE_ENV_VAR];
  if (!url || !key || key.trim().length === 0) throw new TrustedStorageConfigError();
  cachedClient = createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cachedClient;
}

/**
 * Validates a `generated-art` object path is exactly the shape trusted
 * server code is allowed to write: `{userId}/{caseKey}/{filename}`, no
 * more, no fewer segments, no path traversal, and the leading segment must
 * equal the caller's own authenticated `userId` — a compromised/misused
 * internal call still cannot address another user's prefix or escape the
 * bucket's own folder structure, even though `service_role` itself would
 * technically permit it. `caseKey` must be a `cr1_...` caseRef (S1's opaque
 * handle) for any NEW write; a legacy plaintext seed is accepted ONLY as
 * the FROM side of a migration move (`allowLegacySeedSource`), never as a
 * destination — preserving S1's "no seed leaks into a new path" invariant.
 */
function assertValidGeneratedArtPath(path: string, expectedUserId: string, options?: { allowLegacySeedSource?: boolean }): void {
  if (path.includes("..")) throw new TrustedStoragePathError("path traversal segment");
  const segments = path.split("/");
  if (segments.length !== 3) throw new TrustedStoragePathError("expected exactly {userId}/{caseKey}/{filename}");
  const [userId, caseKey, filename] = segments;
  if (!userId || userId !== expectedUserId) throw new TrustedStoragePathError("path's user segment does not match the authenticated caller");
  if (!filename) throw new TrustedStoragePathError("missing filename segment");
  const caseKeyOk = isCaseRef(caseKey) || (options?.allowLegacySeedSource === true && isLegacyCaseSeed(caseKey));
  if (!caseKeyOk) throw new TrustedStoragePathError("case key segment must be a caseRef (or, for a migration source only, a legacy seed)");
}

/** Uploads generated image bytes to the trusted server-only path. `userId`
 * is the caller's own already-authenticated identity (see
 * `lib/game-session/identity.ts#getCurrentIdentity`) — never a
 * browser-supplied value trusted as-is; the path is re-validated against it
 * regardless of what the caller intended. `caseRef` must already be S1's
 * opaque handle, never a raw seed. */
export async function uploadGeneratedAsset(userId: string, caseRef: string, descriptorHash: string, bytes: Uint8Array, contentType: string): Promise<{ path: string }> {
  if (!isCaseRef(caseRef)) throw new TrustedStoragePathError("uploadGeneratedAsset requires a caseRef, never a raw seed");
  const ext = contentType.split("/")[1] ?? "bin";
  const path = `${userId}/${caseRef}/${descriptorHash}.${ext}`;
  assertValidGeneratedArtPath(path, userId);
  const client = getServiceRoleClient();
  const { error } = await client.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true });
  if (error) throw new Error(`Trusted Storage uploadGeneratedAsset failed: ${error.message}`);
  return { path };
}

/** Moves an object — used only by the S1 legacy-case migration, from a
 * legacy plaintext-seed path to the caseRef-keyed path. The destination is
 * always validated as a genuine caseRef; the source is the one place a
 * legacy seed segment is tolerated, and only because it is being retired by
 * this exact call, never written fresh. */
export async function moveGeneratedAsset(userId: string, fromPath: string, toPath: string): Promise<boolean> {
  assertValidGeneratedArtPath(fromPath, userId, { allowLegacySeedSource: true });
  assertValidGeneratedArtPath(toPath, userId);
  const client = getServiceRoleClient();
  const { error } = await client.storage.from(BUCKET).move(fromPath, toPath);
  return !error;
}

/** Not currently called by any pipeline (no delete path exists in
 * Generated Art today — see SECURITY.md's Storage architecture notes) but
 * exposed narrowly for the eventual CONTRACT-time cleanup path rather than
 * leaving destructive Storage capability out of this module's declared,
 * auditable surface entirely. */
export async function removeGeneratedAsset(userId: string, path: string): Promise<boolean> {
  assertValidGeneratedArtPath(path, userId);
  const client = getServiceRoleClient();
  const { error } = await client.storage.from(BUCKET).remove([path]);
  return !error;
}

// Exported for the static path-validation tests only — never used by
// application code outside this module.
export const __testing = { assertValidGeneratedArtPath, TrustedStoragePathError, TrustedStorageConfigError };
