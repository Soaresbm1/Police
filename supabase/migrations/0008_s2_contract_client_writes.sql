-- CASELINE — Security S2, CONTRACT phase (DRAFT ONLY — DO NOT APPLY)
--
-- Applying this file makes the old direct-write path (what current
-- Production `ae2a2b0` and any pre-S2 application code depends on) stop
-- working. It must be applied ONLY after:
--   1. the S2 application (using caseline_advance_time /
--      caseline_finalize_case / caseline_update_profile_preferences /
--      the P1 functions below) is the ONLY application writing this
--      shared database — i.e. deployed to Production, not just Preview;
--   2. normal gameplay and the offensive re-audit have both passed on
--      that S2 application;
--   3. explicit user approval for this specific file, separately from
--      EXPAND approval.
--
-- Player-owned content (notes, board, player_timeline) and profile
-- preferences keep a direct write path via column-level grants — only
-- the columns a player has no legitimate reason to set directly are
-- removed from the broad grant.

-- ---------------------------------------------------------------------
-- investigation_sessions — replace "own the whole row" with "own these
-- specific columns". auth.uid() = user_id remains necessary (still
-- enforced by the existing RLS UPDATE policy) but is no longer
-- sufficient on its own: PostgREST/Postgres reject a column outside this
-- list with a permission error before RLS is even evaluated.
-- ---------------------------------------------------------------------
revoke update on public.investigation_sessions from authenticated;
grant update (notes, board, player_timeline) on public.investigation_sessions to authenticated;
-- current_time_minutes, evidence_status, accusation, seed, mandates,
-- surveillance, hint_state, investigation_events, crime_scene_examined,
-- crime_scene_inspected_zone_ids, last_action_message,
-- last_revealed_evidence_ids, session_uuid: writable only through
-- caseline_advance_time / caseline_finalize_case / the P1 functions
-- (evidence, mandates, lab), which run as this table's owner and are not
-- subject to the column grant above.

-- SELECT stays as-is (auth.uid() = user_id, whole row) — S2's priority is
-- write authority, not read minimization (see interim report §63/§95:
-- optional, deliberately not done here to avoid risking session loading
-- for an optimization that isn't the P0 target).

comment on policy sessions_update_own on public.investigation_sessions is
  'Ownership only — NOT sufficient for authoritative columns (time, evidence, accusation, seed, mandates, hint_state, ...), which are restricted to a narrow column grant below and written only through caseline_* SECURITY DEFINER functions. Do not widen this policy to plain "auth.uid() = user_id" UPDATE access without re-adding the column grant restriction.';

-- ---------------------------------------------------------------------
-- profiles — remove the broad UPDATE grant entirely. Preferences go
-- through caseline_update_profile_preferences; xp/rank/counters go
-- through caseline_finalize_case. No column grant needed here (unlike
-- investigation_sessions) because there is no player-owned free-text
-- column on this table that still needs a direct path — display_name
-- has no existing write path in the application today (see interim
-- report §16); add a column grant for it here if that changes.
-- ---------------------------------------------------------------------
revoke update on public.profiles from authenticated;

comment on policy profiles_update_own on public.profiles is
  'Ownership only — UPDATE grant has been revoked for authenticated (see migration 0008); all writes go through caseline_update_profile_preferences or caseline_finalize_case. This policy is inert until/unless a column grant is added back.';

-- ---------------------------------------------------------------------
-- case_history — INSERT was the exploitable path (forged history). SELECT
-- stays so players can read their own legitimate history.
-- ---------------------------------------------------------------------
revoke insert on public.case_history from authenticated;

comment on policy case_history_insert_own on public.case_history is
  'Retained for documentation only — the INSERT grant itself has been revoked from authenticated (migration 0008); this policy no longer has any effect and is not a security boundary. All rows are written by caseline_finalize_case.';

-- ---------------------------------------------------------------------
-- generated_assets / Storage — P1, drafted separately (see interim
-- report §18-19); intentionally NOT included in this CONTRACT file so
-- the P0 contract can be reviewed and applied independently. The
-- automatic portrait/scene generation write path
-- (lib/art/generation/asset-store.ts) must be migrated to the
-- capability-gated function pattern before any grant here is revoked, or
-- Generated Art stops working entirely.
-- ---------------------------------------------------------------------
