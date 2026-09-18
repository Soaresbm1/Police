import type { Difficulty } from "@/lib/game-engine/types/case";
import type { LabJob, PlayerTimelineEntry, MandateRecord, SurveillanceRecord, BoardState, Accusation, GameSession } from "../types";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/supabase/database.types";
import { isLegacyCaseSeed } from "@/lib/game-engine/random/rng";
import { getS1Keys, S1ConfigError, type S1Keys } from "@/lib/security/s1-keys";
import { resolveStoredSessionSeed, sealSessionSeed, SeedEnvelopeError, type ResolvedStoredSeed } from "@/lib/security/seed-envelope";
import { computeCaseRef } from "@/lib/security/case-ref";
import * as generatedAssetStore from "@/lib/art/generation/asset-store";
import { migrateLegacyCaseArt } from "@/lib/art/generation/legacy-case-migration";
import { normalizeHintState } from "../hints";
import { rememberStoredSeed, storedSeedForSave, upgradeLegacySessionSeed, type SessionSeedColumnOps } from "./session-seed";
import { getS2ServerCapabilityToken } from "@/lib/security/s2-server-capability";
import type { AllowedTimeDelta, CaseHistoryEntry, FinalizeCaseInput, FinalizeCaseResult, PlayerProfile, PlayerSettings, SessionStore } from "./types";

/** jsonb columns round-trip through `Json` — every read needs a two-step
 * cast (there's no structural overlap TypeScript can verify on its own)
 * back to the concrete shape the rest of the app already works with. */
function fromJson<T>(value: Json): T {
  return value as unknown as T;
}

type ServerSupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

/** Security S1 — logs a fixed reason code only: never a seed, envelope,
 * key, user id or storage path. */
function logS1Failure(context: string, err: unknown): void {
  const code = err instanceof S1ConfigError || err instanceof SeedEnvelopeError ? err.code : "UNEXPECTED";
  console.error(`[CASELINE] [S1] ${context}: ${code}`);
}

function sealForWrite(session: GameSession, userId: string): string {
  try {
    return storedSeedForSave(session, userId, getS1Keys());
  } catch (err) {
    logS1Failure("refusing to persist session seed", err);
    throw err;
  }
}

function sessionSeedColumnOps(supabase: ServerSupabaseClient): SessionSeedColumnOps {
  return {
    async compareAndSwapSeed(userId, expected, next) {
      const { data, error } = await supabase
        .from("investigation_sessions")
        .update({ seed: next })
        .eq("user_id", userId)
        .eq("seed", expected)
        .select("user_id");
      if (error) throw new Error("seed compare-and-swap failed");
      return (data ?? []).length === 1;
    },
    async readStoredSeed(userId) {
      const { data, error } = await supabase.from("investigation_sessions").select("seed").eq("user_id", userId).maybeSingle();
      if (error) throw new Error("stored seed read failed");
      return data?.seed ?? null;
    },
  };
}

/** Legacy Generated Art migration runs at most once concurrently per case
 * in this process, and is skipped for the rest of the process's life once a
 * pass leaves nothing behind. Keyed by caseRef, never by the seed. */
const artMigrationInFlight = new Map<string, Promise<void>>();
const artMigrationComplete = new Set<string>();

async function migrateLegacyArtOnce(userId: string, legacySeed: string, keys: S1Keys): Promise<void> {
  const caseRef = computeCaseRef(legacySeed, keys);
  const key = `${userId}:${caseRef}`;
  if (artMigrationComplete.has(key)) return;
  let pending = artMigrationInFlight.get(key);
  if (!pending) {
    pending = (async () => {
      try {
        const result = await migrateLegacyCaseArt(generatedAssetStore, userId, legacySeed, caseRef);
        if (result.failedRows === 0) artMigrationComplete.add(key);
        if (result.rows > 0) {
          console.log(
            `[CASELINE] [S1] legacy art migration ${caseRef}: rows=${result.rows}, moved=${result.movedObjects}, relabeled=${result.relabeledRows}, failed=${result.failedRows}.`,
          );
        }
      } catch {
        console.warn(`[CASELINE] [S1] legacy art migration ${caseRef} deferred (will retry on next load).`);
      } finally {
        artMigrationInFlight.delete(key);
      }
    })();
    artMigrationInFlight.set(key, pending);
  }
  await pending;
}

export type SessionRow = Database["public"]["Tables"]["investigation_sessions"]["Row"];
type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
type HistoryRow = Database["public"]["Tables"]["case_history"]["Row"];

/** `seed` is the LOGICAL seed. It defaults to resolving the stored column
 * (decrypting an S1 envelope for `row.user_id`, or accepting a legacy
 * plaintext value) and throws rather than ever passing ciphertext through. */
export function rowToSession(row: SessionRow, seed: string = resolveStoredSessionSeed(row.seed, row.user_id).seed): GameSession {
  return {
    id: row.user_id,
    sessionUuid: row.session_uuid,
    seed,
    difficulty: row.difficulty as Difficulty,
    createdAt: new Date(row.created_at).getTime(),
    currentTime: row.current_time_minutes,
    evidenceStatus: fromJson<GameSession["evidenceStatus"]>(row.evidence_status),
    labQueue: fromJson<LabJob[]>(row.lab_queue),
    // Absent/null on any row persisted before this column existed (the
    // migration backfills it to '[]' for every pre-existing row, but this
    // stays defensive in case that's ever bypassed) — never fails to
    // deserialize an older investigation, just starts it with no events.
    events: row.investigation_events ? fromJson<GameSession["events"]>(row.investigation_events) : [],
    notes: row.notes,
    playerTimeline: fromJson<PlayerTimelineEntry[]>(row.player_timeline),
    interrogated: fromJson<GameSession["interrogated"]>(row.interrogated),
    mandates: fromJson<Record<string, MandateRecord>>(row.mandates),
    // Same defensive pattern as `events` above — absent/null on any row
    // persisted before this column existed.
    surveillance: row.surveillance ? fromJson<Record<string, SurveillanceRecord>>(row.surveillance) : {},
    board: fromJson<BoardState>(row.board),
    accusation: row.accusation ? fromJson<Accusation>(row.accusation) : null,
    crimeSceneExamined: row.crime_scene_examined,
    crimeSceneInspectedZoneIds: fromJson<string[]>(row.crime_scene_inspected_zone_ids),
    lastRevealedEvidenceIds: fromJson<string[]>(row.last_revealed_evidence_ids),
    lastActionMessage: row.last_action_message,
    // Phase 2 (investigation guidance) — see supabase/migrations/
    // 0006_hint_state.sql. `normalizeHintState` tolerates null/{}/a
    // partial or corrupted object (any row persisted before this column
    // existed, or edited directly) and always returns a valid HintState
    // rather than throwing — see its own doc comment in hints.ts.
    hintState: normalizeHintState(row.hint_state),
  };
}

/** Exported for the persistence round-trip tests (req. 6) — every other
 * caller stays internal to this file. Security S1: `storedSeed` is what
 * lands in the `seed` column and is always an `s1e.v1.…` envelope — by
 * default a fresh seal of `session.seed` bound to `userId`.
 *
 * Security S2: `session_uuid` is deliberately OMITTED from this payload
 * unless `includeSessionUuid` is set. `createSession` is the only caller
 * that sets it, because it's the only moment a *new* investigation
 * instance exists — every ordinary `saveSession` upsert takes the UPDATE
 * arm (a row for this `user_id` already exists), and PostgREST/Postgres
 * only ever touch the columns present in the payload on that arm, so
 * omitting this key is what makes `session_uuid` survive unchanged across
 * every normal in-game save. See `GameSession#sessionUuid`. */
export function sessionToRow(
  userId: string,
  session: GameSession,
  storedSeed: string = sealSessionSeed(session.seed, userId),
  options?: { includeSessionUuid?: boolean },
): Database["public"]["Tables"]["investigation_sessions"]["Insert"] {
  return {
    user_id: userId,
    seed: storedSeed,
    ...(options?.includeSessionUuid ? { session_uuid: session.sessionUuid } : {}),
    difficulty: session.difficulty,
    current_time_minutes: session.currentTime,
    evidence_status: session.evidenceStatus as unknown as Json,
    lab_queue: session.labQueue as unknown as Json,
    investigation_events: session.events as unknown as Json,
    notes: session.notes,
    player_timeline: session.playerTimeline as unknown as Json,
    interrogated: session.interrogated as unknown as Json,
    mandates: session.mandates as unknown as Json,
    surveillance: session.surveillance as unknown as Json,
    board: session.board as unknown as Json,
    accusation: session.accusation as unknown as Json,
    crime_scene_examined: session.crimeSceneExamined,
    crime_scene_inspected_zone_ids: session.crimeSceneInspectedZoneIds as unknown as Json,
    last_action_message: session.lastActionMessage,
    last_revealed_evidence_ids: session.lastRevealedEvidenceIds as unknown as Json,
    hint_state: session.hintState as unknown as Json,
    updated_at: new Date().toISOString(),
  };
}

function rowToProfile(row: ProfileRow): PlayerProfile {
  return {
    userId: row.id,
    displayName: row.display_name,
    rank: row.rank,
    xp: row.xp,
    casesSolved: row.cases_solved,
    casesFailed: row.cases_failed,
    accusationsTotal: row.accusations_total,
    settings: {
      soundMuted: row.sound_muted,
      reduceMotion: row.reduce_motion,
      hintsDisabled: row.hints_disabled,
    },
  };
}

function rowToHistoryEntry(row: HistoryRow): CaseHistoryEntry {
  return {
    id: row.id,
    seed: row.seed,
    difficulty: row.difficulty as Difficulty,
    accusation: fromJson<Accusation>(row.accusation),
    score: fromJson<CaseHistoryEntry["score"]>(row.score),
    completedAt: new Date(row.completed_at).getTime(),
  };
}

/**
 * Supabase-backed implementation, used automatically once
 * `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are set (see
 * `lib/supabase/config.ts`). Every query runs through the request-scoped,
 * RLS-bound client from `lib/supabase/server.ts` — there is no
 * service-role client here, so a bug in this file can only ever touch rows
 * the signed-in user already owns.
 */
export class SupabaseSessionStore implements SessionStore {
  private async client() {
    return createServerSupabaseClient();
  }

  /**
   * Security S1: the stored seed is decrypted here and only here. A
   * legacy plaintext row is upgraded in place (seed column only) on this
   * first authenticated load, and a legacy case's Generated Art is moved off
   * its plaintext-seed paths. Missing/invalid key material or an envelope
   * that fails to authenticate throws — never `null`, which callers would
   * show as "no investigation".
   */
  async getActiveSession(userId: string): Promise<GameSession | null> {
    const supabase = await this.client();
    const { data, error } = await supabase.from("investigation_sessions").select("*").eq("user_id", userId).maybeSingle();
    if (error) throw new Error(`Supabase getActiveSession failed: ${error.message}`);
    if (!data) return null;

    let keys: S1Keys;
    let resolved: ResolvedStoredSeed;
    try {
      keys = getS1Keys();
      resolved = resolveStoredSessionSeed(data.seed, userId, keys);
    } catch (err) {
      logS1Failure("active session unreadable", err);
      throw err;
    }

    const session = rowToSession(data, resolved.seed);
    let stored = data.seed;
    if (resolved.kind === "legacy_plaintext") {
      const upgrade = await upgradeLegacySessionSeed(sessionSeedColumnOps(supabase), userId, resolved.seed, keys);
      if (upgrade.outcome === "not_upgraded") console.warn("[CASELINE] [S1] legacy session seed upgrade deferred (will retry on next load/save).");
      stored = upgrade.stored;
    }
    rememberStoredSeed(session, stored);

    if (isLegacyCaseSeed(resolved.seed)) await migrateLegacyArtOnce(userId, resolved.seed, keys);
    return session;
  }

  async createSession(userId: string, seed: string, difficulty: Difficulty, crimeTimestamp: number): Promise<GameSession> {
    const session: GameSession = {
      id: userId,
      sessionUuid: crypto.randomUUID(),
      seed,
      difficulty,
      createdAt: Date.now(),
      currentTime: crimeTimestamp,
      evidenceStatus: {},
      labQueue: [],
      events: [],
      notes: "",
      playerTimeline: [],
      interrogated: {},
      mandates: {},
      surveillance: {},
      board: { nodes: [], edges: [] },
      accusation: null,
      crimeSceneExamined: false,
      crimeSceneInspectedZoneIds: [],
      lastRevealedEvidenceIds: [],
      hintState: { progress: {}, history: [], totalHintsUsed: 0 },
      lastActionMessage: null,
    };
    // Sealed before any network call: without S1 key material this throws
    // and nothing is written — never a plaintext fallback for a new case.
    const storedSeed = sealForWrite(session, userId);
    const supabase = await this.client();
    // A player can only ever have one active investigation — replace
    // rather than error if one somehow still exists (e.g. an abandoned
    // case that was never explicitly ended). `includeSessionUuid: true`
    // is what gives this brand-new investigation instance its own fresh
    // identity even when this upsert takes the UPDATE arm (reusing an
    // existing row) — see `sessionToRow`'s own doc comment.
    const { error } = await supabase
      .from("investigation_sessions")
      .upsert(sessionToRow(userId, session, storedSeed, { includeSessionUuid: true }), { onConflict: "user_id" });
    if (error) throw new Error(`Supabase createSession failed: ${error.message}`);
    return session;
  }

  async saveSession(userId: string, session: GameSession): Promise<void> {
    const storedSeed = sealForWrite(session, userId);
    const supabase = await this.client();
    const { error } = await supabase.from("investigation_sessions").upsert(sessionToRow(userId, session, storedSeed), { onConflict: "user_id" });
    if (error) throw new Error(`Supabase saveSession failed: ${error.message}`);
  }

  async deleteActiveSession(userId: string): Promise<void> {
    const supabase = await this.client();
    const { error } = await supabase.from("investigation_sessions").delete().eq("user_id", userId);
    if (error) throw new Error(`Supabase deleteActiveSession failed: ${error.message}`);
  }

  async getProfile(userId: string): Promise<PlayerProfile> {
    const supabase = await this.client();
    const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
    if (error) throw new Error(`Supabase getProfile failed: ${error.message}`);
    if (data) return rowToProfile(data);

    // The on_auth_user_created trigger should already have created this —
    // this is only a safety net (e.g. a user created before the trigger
    // existed).
    const { data: created, error: insertError } = await supabase
      .from("profiles")
      .insert({ id: userId })
      .select("*")
      .single();
    if (insertError) throw new Error(`Supabase getProfile fallback insert failed: ${insertError.message}`);
    return rowToProfile(created);
  }

  /** Security S2 — routes through `caseline_update_profile_preferences`
   * (ownership-checked via `auth.uid()` inside the function; no capability
   * token needed) instead of a whole-row `UPDATE`, so this keeps working
   * unchanged once S2's CONTRACT phase removes the broad `profiles` grant. */
  async updateSettings(userId: string, patch: Partial<PlayerSettings>): Promise<PlayerProfile> {
    const supabase = await this.client();
    const { error } = await supabase.rpc("caseline_update_profile_preferences", {
      p_sound_muted: patch.soundMuted ?? null,
      p_reduce_motion: patch.reduceMotion ?? null,
      p_hints_disabled: patch.hintsDisabled ?? null,
    });
    if (error) throw new Error(`Supabase updateSettings failed: ${error.message}`);
    return this.getProfile(userId);
  }

  /** Security S2 — the game clock's only sanctioned mutation path once
   * CONTRACT lands; routes through `caseline_advance_time`, which enforces
   * both ownership (`auth.uid()`) and the delta allow-list at the database
   * layer, independent of anything this TypeScript call site does. */
  async advanceTime(userId: string, sessionUuid: string, minutes: AllowedTimeDelta): Promise<number> {
    const supabase = await this.client();
    const { data, error } = await supabase.rpc("caseline_advance_time", { p_session_uuid: sessionUuid, p_minutes: minutes });
    if (error) throw new Error(`Supabase advanceTime failed: ${error.message}`);
    const row = (Array.isArray(data) ? data[0] : data) as { current_time_minutes: number } | undefined;
    if (!row) throw new Error("Supabase advanceTime returned no row");
    void userId; // ownership is enforced inside the function via auth.uid(), not by this argument
    return row.current_time_minutes;
  }

  /** Security S2 — one atomic, idempotent resolution via
   * `caseline_finalize_case`. The server-only capability token proves this
   * call carries a genuinely server-computed result (score/grade/XP,
   * regenerated from CaseTruth) rather than a value a direct caller chose
   * for themselves — see SECURITY.md §S2 "capability call path". Fails
   * closed (throws, writes nothing) if the token isn't configured. */
  async finalizeCase(userId: string, sessionUuid: string, input: FinalizeCaseInput): Promise<FinalizeCaseResult> {
    const supabase = await this.client();
    const token = getS2ServerCapabilityToken();
    const { data, error } = await supabase.rpc("caseline_finalize_case", {
      p_server_token: token,
      p_session_uuid: sessionUuid,
      p_seed: input.seed,
      p_difficulty: input.difficulty,
      p_accusation: input.accusation as unknown as Json,
      p_score: input.score as unknown as Json,
      p_xp_gained: input.xpGained,
      p_culprit_correct: input.culpritCorrect,
    });
    if (error) throw new Error(`Supabase finalizeCase failed: ${error.message}`);
    const row = (Array.isArray(data) ? data[0] : data) as { history_id: string; already_finalized: boolean } | undefined;
    if (!row) throw new Error("Supabase finalizeCase returned no row");
    const profile = await this.getProfile(userId);
    return { historyId: row.history_id, alreadyFinalized: row.already_finalized, profile };
  }

  async listCaseHistory(userId: string): Promise<CaseHistoryEntry[]> {
    const supabase = await this.client();
    const { data, error } = await supabase
      .from("case_history")
      .select("*")
      .eq("user_id", userId)
      .order("completed_at", { ascending: false });
    if (error) throw new Error(`Supabase listCaseHistory failed: ${error.message}`);
    return (data ?? []).map(rowToHistoryEntry);
  }

  async getCaseHistoryEntry(userId: string, entryId: string): Promise<CaseHistoryEntry | null> {
    const supabase = await this.client();
    const { data, error } = await supabase
      .from("case_history")
      .select("*")
      .eq("user_id", userId)
      .eq("id", entryId)
      .maybeSingle();
    if (error) throw new Error(`Supabase getCaseHistoryEntry failed: ${error.message}`);
    return data ? rowToHistoryEntry(data) : null;
  }
}
