-- CASELINE — Security S2, forward-fix (DRAFT — NOT YET APPLIED)
--
-- Found live in Production immediately after 0008 (CONTRACT) was applied:
-- `createSession` used `.upsert(sessionToRow(...), { onConflict: "user_id" })`.
-- For a player who already has an active investigation (the common case —
-- every returning player), PostgREST/Postgres take the UPDATE arm of that
-- upsert with the *full* authoritative row (seed, current_time_minutes,
-- evidence_status, lab_queue, mandates, surveillance, board, accusation,
-- hint_state, ...). None of those columns are in 0008's 7-column grant, so
-- Postgres correctly rejects the whole statement with "permission denied
-- for table investigation_sessions" — CONTRACT is working exactly as
-- designed; the application's write path for starting a new case is what
-- needed to move behind a trusted mutation, exactly like every other
-- authoritative write already did in 0007/0009.
--
-- This is the same trusted-mutation architecture as every other
-- SECURITY DEFINER function in this codebase: SERVER-CAPABILITY-REQUIRED
-- (Next.js has already generated the new seed and regenerated CaseTruth —
-- neither exists in Postgres — and this function only persists that
-- already-authoritative starting state), ownership derived exclusively
-- from auth.uid(), a fresh session_uuid generated server-side (inside this
-- function, never chosen by the caller), and every universal initial value
-- (empty evidence/lab/mandates/surveillance/board/hint_state, no
-- accusation) hardcoded as a literal rather than accepted as a parameter —
-- narrower than accepting a full row snapshot, and it means even Next.js
-- itself cannot pass a malformed or non-empty initial authoritative value.
--
-- Only three values are genuinely case-specific and must come from the
-- caller: the sealed S1 seed envelope, the difficulty, and the crime
-- timestamp CaseTruth generation computed. `p_seed` is validated to already
-- be an `s1e.v1.…` envelope — this function never accepts, stores, or
-- forwards a plaintext seed.
--
-- Idempotency / double-submit: two near-simultaneous calls for the same
-- player are treated as two distinct, fully legitimate "start a new case"
-- actions (there is no natural "already done" state to collapse them into,
-- unlike caseline_finalize_case's one-time claim on an existing row). Each
-- call atomically installs a complete, internally-consistent row via a
-- single INSERT ... ON CONFLICT (user_id) DO UPDATE — Postgres never
-- produces a hybrid of two calls' values, and whichever call's statement
-- commits last is the investigation the player ends up with. No duplicate
-- rows can ever exist (the table has exactly one row per user_id, enforced
-- by its own primary key / unique constraint from 0001).
--
-- Does NOT touch grants, RLS, or Storage policies. Does NOT reopen any
-- authoritative column to direct authenticated UPDATE. Additive only —
-- exactly like 0007 and 0009 before CONTRACT: Production continues to work
-- unchanged for every write path that isn't this one until the application
-- is redeployed to call this function.

create or replace function public.caseline_create_session(
  p_server_token text,
  p_seed text,
  p_difficulty text,
  p_current_time_minutes integer
)
returns table (session_uuid uuid)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid;
  v_new_uuid uuid;
begin
  perform public.caseline_check_server_capability(p_server_token);

  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'caseline: authentication required';
  end if;

  if p_difficulty not in ('recruit', 'investigator', 'inspector', 'expert') then
    raise exception 'caseline: invalid difficulty';
  end if;
  if p_seed is null or p_seed !~ '^s1e\.v1\.' then
    -- Mirrors isLegacyCaseSeed()/isSealedSeed()'s own s1e.v1 prefix check
    -- (lib/security/seed-envelope.ts) — this function must never accept or
    -- store a plaintext seed, only an already-sealed S1 envelope Next.js
    -- computed before calling here.
    raise exception 'caseline: seed must already be a sealed s1e.v1 envelope';
  end if;

  v_new_uuid := gen_random_uuid();

  insert into public.investigation_sessions (
    user_id, session_uuid, seed, difficulty, current_time_minutes,
    evidence_status, lab_queue, investigation_events, notes, player_timeline,
    interrogated, mandates, surveillance, board, accusation,
    crime_scene_examined, crime_scene_inspected_zone_ids, last_action_message,
    last_revealed_evidence_ids, hint_state, updated_at
  ) values (
    v_uid, v_new_uuid, p_seed, p_difficulty, p_current_time_minutes,
    '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, '', '[]'::jsonb,
    '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{"nodes":[],"edges":[]}'::jsonb, null,
    false, '[]'::jsonb, null,
    '[]'::jsonb, '{"progress":{},"history":[],"totalHintsUsed":0}'::jsonb, now()
  )
  on conflict (user_id) do update set
    session_uuid = excluded.session_uuid,
    seed = excluded.seed,
    difficulty = excluded.difficulty,
    current_time_minutes = excluded.current_time_minutes,
    evidence_status = excluded.evidence_status,
    lab_queue = excluded.lab_queue,
    investigation_events = excluded.investigation_events,
    notes = excluded.notes,
    player_timeline = excluded.player_timeline,
    interrogated = excluded.interrogated,
    mandates = excluded.mandates,
    surveillance = excluded.surveillance,
    board = excluded.board,
    accusation = excluded.accusation,
    crime_scene_examined = excluded.crime_scene_examined,
    crime_scene_inspected_zone_ids = excluded.crime_scene_inspected_zone_ids,
    last_action_message = excluded.last_action_message,
    last_revealed_evidence_ids = excluded.last_revealed_evidence_ids,
    hint_state = excluded.hint_state,
    updated_at = excluded.updated_at;

  return query select v_new_uuid;
end;
$$;

revoke all on function public.caseline_create_session(text, text, text, integer) from public, anon;
grant execute on function public.caseline_create_session(text, text, text, integer) to authenticated;
-- Granted to `authenticated` deliberately, exactly like every other
-- SERVER-CAPABILITY-REQUIRED function (caseline_finalize_case et al.) — the
-- capability-token check inside the function body is the real boundary,
-- not this GRANT. A browser holding only its own JWT + the public key can
-- call this RPC, but cannot produce a token that passes
-- caseline_check_server_capability, and cannot make `auth.uid()` resolve to
-- anyone but itself, so it can only ever replace its own session with a
-- payload it cannot forge the capability for in the first place.
