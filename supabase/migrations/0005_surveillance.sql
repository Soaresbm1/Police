-- CASELINE — police surveillance (Living Investigation System, Phase 5B-1)
--
-- Reuses public.investigation_sessions, same as 0003_investigation_events.sql:
-- `surveillance` is a jsonb object of SurveillanceRecord keyed by
-- `personId:startedAt`, stored and read exactly the way mandates/events
-- already are — see lib/game-session/persistence/supabase-store.ts.
--
-- Idempotent, matching 0001_init.sql/0003's style: `add column if not
-- exists` with a `not null default` backfills every pre-existing row to
-- '{}' automatically, so an investigation created before this migration
-- deserializes with surveillance: {} rather than failing.
--
-- Same discipline as every other column on this table: no CaseTruth field
-- (no culprit id, no hidden roles, no undiscovered-evidence content, no
-- ground-truth timeline) is ever stored here — only the already-computed,
-- observer-safe SurveillanceObservation[] snapshot the player's own
-- request produced, clipped to the window they themselves chose.

alter table public.investigation_sessions
  add column if not exists surveillance jsonb not null default '{}'::jsonb;
