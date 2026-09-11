import type { Difficulty } from "@/lib/game-engine/types/case";
import type { LabJob, PlayerTimelineEntry, MandateRecord, SurveillanceRecord, BoardState, Accusation, GameSession } from "../types";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/supabase/database.types";
import { applyCaseToCareer } from "../career";
import type { CaseHistoryEntry, PlayerProfile, PlayerSettings, SessionStore } from "./types";

/** jsonb columns round-trip through `Json` — every read needs a two-step
 * cast (there's no structural overlap TypeScript can verify on its own)
 * back to the concrete shape the rest of the app already works with. */
function fromJson<T>(value: Json): T {
  return value as unknown as T;
}

export type SessionRow = Database["public"]["Tables"]["investigation_sessions"]["Row"];
type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
type HistoryRow = Database["public"]["Tables"]["case_history"]["Row"];

export function rowToSession(row: SessionRow): GameSession {
  return {
    id: row.user_id,
    seed: row.seed,
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
  };
}

function sessionToRow(userId: string, session: GameSession): Database["public"]["Tables"]["investigation_sessions"]["Insert"] {
  return {
    user_id: userId,
    seed: session.seed,
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

  async getActiveSession(userId: string): Promise<GameSession | null> {
    const supabase = await this.client();
    const { data, error } = await supabase.from("investigation_sessions").select("*").eq("user_id", userId).maybeSingle();
    if (error) throw new Error(`Supabase getActiveSession failed: ${error.message}`);
    return data ? rowToSession(data) : null;
  }

  async createSession(userId: string, seed: string, difficulty: Difficulty, crimeTimestamp: number): Promise<GameSession> {
    const session: GameSession = {
      id: userId,
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
      lastActionMessage: null,
    };
    const supabase = await this.client();
    // A player can only ever have one active investigation — replace
    // rather than error if one somehow still exists (e.g. an abandoned
    // case that was never explicitly ended).
    const { error } = await supabase.from("investigation_sessions").upsert(sessionToRow(userId, session), { onConflict: "user_id" });
    if (error) throw new Error(`Supabase createSession failed: ${error.message}`);
    return session;
  }

  async saveSession(userId: string, session: GameSession): Promise<void> {
    const supabase = await this.client();
    const { error } = await supabase.from("investigation_sessions").upsert(sessionToRow(userId, session), { onConflict: "user_id" });
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

  async updateSettings(userId: string, patch: Partial<PlayerSettings>): Promise<PlayerProfile> {
    const supabase = await this.client();
    const update: Database["public"]["Tables"]["profiles"]["Update"] = { updated_at: new Date().toISOString() };
    if (patch.soundMuted !== undefined) update.sound_muted = patch.soundMuted;
    if (patch.reduceMotion !== undefined) update.reduce_motion = patch.reduceMotion;
    if (patch.hintsDisabled !== undefined) update.hints_disabled = patch.hintsDisabled;

    const { data, error } = await supabase.from("profiles").update(update).eq("id", userId).select("*").single();
    if (error) throw new Error(`Supabase updateSettings failed: ${error.message}`);
    return rowToProfile(data);
  }

  async completeCase(userId: string, entry: Omit<CaseHistoryEntry, "id" | "completedAt">): Promise<PlayerProfile> {
    const supabase = await this.client();
    const profile = await this.getProfile(userId);
    const { newXp, newRank } = applyCaseToCareer(profile.xp, entry.score);

    const { error: historyError } = await supabase.from("case_history").insert({
      user_id: userId,
      seed: entry.seed,
      difficulty: entry.difficulty,
      accusation: entry.accusation as unknown as Json,
      score: entry.score as unknown as Json,
    });
    if (historyError) throw new Error(`Supabase completeCase (history insert) failed: ${historyError.message}`);

    const { data, error: profileError } = await supabase
      .from("profiles")
      .update({
        xp: newXp,
        rank: newRank,
        cases_solved: profile.casesSolved + (entry.score.culpritCorrect ? 1 : 0),
        cases_failed: profile.casesFailed + (entry.score.culpritCorrect ? 0 : 1),
        accusations_total: profile.accusationsTotal + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId)
      .select("*")
      .single();
    if (profileError) throw new Error(`Supabase completeCase (profile update) failed: ${profileError.message}`);
    return rowToProfile(data);
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
