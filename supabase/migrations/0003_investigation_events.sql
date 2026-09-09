-- CASELINE — investigation events (Living Investigation System, Phase 1)
--
-- Reuses public.investigation_sessions (the existing single-row-per-player
-- table) rather than a new table or a new RLS architecture:
-- investigation_events is a jsonb array of InvestigationEvent, stored and
-- read exactly the way lab_queue/player_timeline/mandates already are —
-- see lib/game-session/persistence/supabase-store.ts.
--
-- Idempotent, matching 0001_init.sql's style: `add column if not exists`
-- with a `not null default` backfills every pre-existing row to '[]'
-- automatically (Postgres applies the default to existing rows when the
-- default is a constant, without rewriting the table), so an investigation
-- created before this migration deserializes with events: [] rather than
-- failing or losing any of its other state (evidence, time, lab queue,
-- mandates, board, interrogation progress — none of those columns are
-- touched here).
--
-- Same discipline as every other column on this table: no CaseTruth field
-- (no culprit id, no hidden roles, no undiscovered-evidence content) is
-- ever stored here — only the deterministic event schedule the player has
-- themselves triggered, with player-safe notification text.

alter table public.investigation_sessions
  add column if not exists investigation_events jsonb not null default '[]'::jsonb;
