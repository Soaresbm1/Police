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
--      preferences, finalization via the EXPAND-1 functions) — DONE,
--      validated on Preview;
--   2. EXPAND-2 applied (0009_s2_expand2_trusted_mutations.sql — evidence,
--      lab, mandates, surveillance, hint-state, investigation_events, and
--      Generated Art metadata trusted functions; Generated Art STORAGE
--      writes remain unresolved, see that file's closing section);
--   3. APP-2 live everywhere (actions.ts/discovery.ts/mandates.ts/
--      surveillance.ts/hints.ts/events.ts rewired to call the EXPAND-2
--      functions instead of mutating the session object in place and
--      relying on saveSession's broad upsert — see the EXPAND-2 return
--      report's "session broad-save analysis" for why saveSession itself
--      must stop touching these columns before this file can apply);
--   4. normal gameplay + offensive re-audit both pass;
--   5. explicit user approval for this specific file.
--
-- Do NOT apply piecemeal — a partial CONTRACT (e.g. investigation_sessions
-- restricted before EXPAND-2/APP-2 exist for evidence/mandates/lab) would
-- break those flows for every player using the still-live application.
-- Generated Art Storage policies are explicitly OUT of this file's scope
-- until the service-role/credential question is resolved with the user.

-- ---------------------------------------------------------------------
-- investigation_sessions — replace "own the whole row" with "own these
-- specific columns". auth.uid() = user_id remains necessary (still
-- enforced by the existing RLS UPDATE policy) but is no longer
-- sufficient on its own: PostgREST/Postgres reject a column outside this
-- list with a permission error before RLS is even evaluated.
-- ---------------------------------------------------------------------
revoke update on public.investigation_sessions from authenticated;
grant update (
  notes, board, player_timeline,
  crime_scene_examined, crime_scene_inspected_zone_ids,
  last_action_message, last_revealed_evidence_ids,
  seed
) on public.investigation_sessions to authenticated;
-- The four crime-scene/UI-bookkeeping columns join the grant here per the
-- EXPAND-2 audit: they carry no CaseTruth content and forging them changes
-- nothing authoritative (see 0009's header and the EXPAND-2 return report's
-- crime-scene-state section) — same trust level as notes/board/
-- player_timeline, not the evidence/mandate/lab/surveillance/hint columns
-- below.
--
-- KNOWN GAP, NOT YET RESOLVED: `seed` is granted here only because S1's
-- lazy-migration fallback depends on an ordinary `saveSession` being able
-- to re-seal it (see `sessionToPlayerOwnedRow`'s own doc comment and
-- `s1-session-persistence.test.ts`'s "a failed upgrade... the next load or
-- save completes it"). A forged direct `UPDATE ... SET seed = ...` is still
-- possible through this grant — bypassing S1 entirely for that row (S1
-- protects confidentiality of a legitimately-sealed seed, not integrity of
-- the column against a malicious owner-role write, and this was already
-- true before EXPAND-2/APP-2). Closing this needs a dedicated
-- capability-gated `caseline_reseal_seed`-style function so `seed` can join
-- the revoked set too; out of scope for this pass (S2 targets game-state
-- write authority, not seed confidentiality, which S1 already owns) and
-- explicitly flagged rather than silently left as a "player-owned" column.
--
-- Everything else — current_time_minutes, evidence_status, accusation,
-- mandates, surveillance, hint_state, investigation_events,
-- session_uuid — is writable only through caseline_advance_time /
-- caseline_finalize_case / caseline_collect_evidence /
-- caseline_reveal_evidence / caseline_submit_to_lab /
-- caseline_request_mandate / caseline_start_surveillance /
-- caseline_record_hint / caseline_mark_event_seen (0007 + 0009), all of
-- which run as this table's owner and are not subject to the column grant
-- above.

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
