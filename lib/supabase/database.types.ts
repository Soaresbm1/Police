/**
 * Hand-authored to match `supabase/migrations/0001_init.sql` exactly, in
 * the same shape the Supabase CLI would generate. Once a real Supabase
 * project exists, regenerate with
 * `supabase gen types typescript --project-id <id> > lib/supabase/database.types.ts`
 * and this file becomes redundant — keep the shapes in sync until then.
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          display_name: string;
          rank: string;
          xp: number;
          cases_solved: number;
          cases_failed: number;
          accusations_total: number;
          sound_muted: boolean;
          reduce_motion: boolean;
          hints_disabled: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["profiles"]["Row"]> & { id: string };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Row"]>;
        Relationships: [];
      };
      investigation_sessions: {
        Row: {
          user_id: string;
          seed: string;
          difficulty: string;
          current_time_minutes: number;
          evidence_status: Json;
          lab_queue: Json;
          investigation_events: Json;
          notes: string;
          player_timeline: Json;
          interrogated: Json;
          mandates: Json;
          surveillance: Json;
          board: Json;
          accusation: Json | null;
          crime_scene_examined: boolean;
          crime_scene_inspected_zone_ids: Json;
          last_action_message: string | null;
          last_revealed_evidence_ids: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["investigation_sessions"]["Row"]> & {
          user_id: string;
          seed: string;
          difficulty: string;
          current_time_minutes: number;
        };
        Update: Partial<Database["public"]["Tables"]["investigation_sessions"]["Row"]>;
        Relationships: [];
      };
      case_history: {
        Row: {
          id: string;
          user_id: string;
          seed: string;
          difficulty: string;
          accusation: Json;
          score: Json;
          completed_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["case_history"]["Row"]> & {
          user_id: string;
          seed: string;
          difficulty: string;
          accusation: Json;
          score: Json;
        };
        Update: Partial<Database["public"]["Tables"]["case_history"]["Row"]>;
        Relationships: [];
      };
      generated_assets: {
        Row: {
          id: string;
          user_id: string;
          case_seed: string;
          asset_kind: string;
          descriptor_hash: string;
          generation_version: number;
          provider: string;
          provider_model: string | null;
          status: string;
          storage_path: string | null;
          width: number | null;
          height: number | null;
          prompt_version: number | null;
          error_message: string | null;
          attempt_count: number;
          failed_at: string | null;
          created_at: string;
          updated_at: string;
          reuse_key: string | null;
          reuse_count: number;
          source_asset_id: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["generated_assets"]["Row"]> & {
          user_id: string;
          case_seed: string;
          asset_kind: string;
          descriptor_hash: string;
          generation_version: number;
          provider: string;
        };
        Update: Partial<Database["public"]["Tables"]["generated_assets"]["Row"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      increment_reuse_count: {
        Args: { asset_id: string; owner_id: string };
        Returns: undefined;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
