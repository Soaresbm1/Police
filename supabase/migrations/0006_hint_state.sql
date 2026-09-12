-- CASELINE — investigation-guidance hint state (Motive & Digital Evidence
-- Phase 2)
--
-- Reuses public.investigation_sessions, same as every prior additive column
-- on this table (0003_investigation_events.sql, 0005_surveillance.sql):
-- `hint_state` is a jsonb object matching `HintState` (types.ts) — stored
-- and read exactly the way events/mandates/surveillance already are, see
-- lib/game-session/persistence/supabase-store.ts.
--
-- Idempotent, matching 0001/0003/0005's style: `add column if not exists`
-- with a `not null default` backfills every pre-existing row to the empty
-- HintState shape automatically, so an investigation created before this
-- migration deserializes with `hintState: { progress: {}, history: [],
-- totalHintsUsed: 0 }` rather than failing or losing any other state
-- (evidence, time, lab queue, mandates, board, interrogation progress,
-- surveillance — none of those columns are touched here).
--
-- Same discipline as every other column on this table: no CaseTruth field
-- (no culprit id, no actual motive, no hidden channel/priority metadata) is
-- ever stored here — only the already-safe, already-rendered hint text and
-- level the player themselves already saw (see hints.ts's own truth-safety
-- accounting).

alter table public.investigation_sessions
  add column if not exists hint_state jsonb not null
  default '{"progress":{},"history":[],"totalHintsUsed":0}'::jsonb;
