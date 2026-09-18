-- CASELINE — Security S2, CONTRACT phase (DRAFT ONLY — DO NOT APPLY)
--
-- This is the TRUE final S2 end-state: after this file, a normal
-- authenticated player can directly write ONLY their own legitimate
-- player-owned content and preferences. Every server-authoritative field
-- across all four tables is denied to direct authenticated writes.
--
-- Applying this file makes the OLD direct-write path (what current
-- Production `ae2a2b0`, and any application that hasn't finished APP-1 +
-- APP-2, depends on) stop working. Sequencing requirement:
--   1. APP-1 live everywhere writing this shared database (time advance,
--      preferences, finalization via the EXPAND-1 functions);
--   2. EXPAND-2 applied (evidence/mandate/lab/surveillance/hint trusted
--      functions, Generated Art capability-gated writes — not yet
--      designed/drafted; this file assumes they exist under the naming
--      convention `caseline_*`, same pattern as EXPAND-1);
--   3. APP-2 live everywhere;
--   4. normal gameplay + offensive re-audit both pass;
--   5. explicit user approval for this specific file.
--
-- Do NOT apply piecemeal — a partial CONTRACT (e.g. investigation_sessions
-- restricted before EXPAND-2/APP-2 exist for evidence/mandates/lab) would
-- break those flows for every player using the still-live application.

-- ---------------------------------------------------------------------
-- investigation_sessions — replace "own the whole row" with "own these
-- specific columns". auth.uid() = user_id remains necessary (still
-- enforced by the existing RLS UPDATE policy) but is no longer
-- sufficient on its own: PostgREST/Postgres reject a column outside this
-- list with a permission error before RLS is even evaluated.
-- ---------------------------------------------------------------------
revoke update on public.investigation_sessions from authenticated;
grant update (notes, board, player_timeline) on public.investigation_sessions to authenticated;
-- Everything else — current_time_minutes, evidence_status, accusation,
-- seed, mandates, surveillance, hint_state, investigation_events,
-- crime_scene_examined, crime_scene_inspected_zone_ids,
-- last_action_message, last_revealed_evidence_ids, session_uuid — is
-- writable only through caseline_advance_time / caseline_finalize_case /
-- the EXPAND-2 evidence/mandate/lab/surveillance/hint functions, all of
-- which run as this table's owner and are not subject to the column
-- grant above.

comment on policy sessions_update_own on public.investigation_sessions is
  'Ownership only — NOT sufficient for authoritative columns (time, evidence, accusation, seed, mandates, hint_state, ...), which are restricted to a narrow column grant (see migration 0008) and written only through caseline_* SECURITY DEFINER functions. Do not widen this policy to plain "auth.uid() = user_id" UPDATE access without re-adding the column grant restriction.';

-- SELECT stays as-is (auth.uid() = user_id, whole row) — S2's priority is
-- write authority, not read minimization (see the interim report's §63/
-- §95: optional, deliberately not done here to avoid risking session
-- loading for an optimization that isn't the P0/P1 target).

-- ---------------------------------------------------------------------
-- profiles — remove the broad UPDATE grant entirely. Preferences go
-- through caseline_update_profile_preferences; xp/rank/counters go
-- through caseline_finalize_case. No column grant needed here (unlike
-- investigation_sessions) because there is no player-owned free-text
-- column on this table with an existing write path today — display_name
-- has no current application write path (see interim report §16); add a
-- column grant for it here if that changes.
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
-- generated_assets — the same "own the row = own the metadata" gap as
-- the other tables. A trusted `caseline_write_generated_asset(...)`-style
-- function family (EXPAND-2, not yet drafted) must exist and be in use by
-- lib/art/generation/asset-store.ts before this runs, or automatic
-- portrait/scene generation breaks entirely for every player.
-- ---------------------------------------------------------------------
revoke insert, update on public.generated_assets from authenticated;
-- delete was never granted (see 0002_generated_assets.sql) — unaffected.

comment on policy generated_assets_insert_own on public.generated_assets is
  'Retained for documentation only — INSERT/UPDATE grants revoked from authenticated (migration 0008). Rows are written only by the trusted EXPAND-2 Generated Art functions.';
comment on policy generated_assets_update_own on public.generated_assets is
  'Retained for documentation only — see generated_assets_insert_own.';

-- ---------------------------------------------------------------------
-- Storage — `generated-art` bucket. Players keep read access (signed URLs
-- continue to work, per S1); direct INSERT/UPDATE from the player's own
-- browser session is removed. The trusted server path
-- (uploadAssetBytes()/the EXPAND-2 move-on-migration path) must upload
-- using the same per-user-authenticated client it uses today — since
-- there is no service-role client, its write capability must come from a
-- source these policies still allow, e.g. a narrow policy scoped to
-- paths only trusted server code can name (requires EXPAND-2 design; not
-- resolved by this draft alone — see the interim report's Storage
-- section for the same capability-model question that applies here).
-- ---------------------------------------------------------------------
drop policy if exists "generated_art_insert_own" on storage.objects;
drop policy if exists "generated_art_update_own" on storage.objects;
-- generated_art_select_own is untouched — reading a signed URL for one's
-- own generated art keeps working exactly as it does under S1.
