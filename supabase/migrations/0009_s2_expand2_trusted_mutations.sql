-- CASELINE — Security S2, EXPAND-2 (DRAFT — NOT YET APPLIED)
--
-- Completes the trusted-mutation architecture EXPAND-1 started: every
-- remaining authoritative investigation_sessions column (evidence_status,
-- lab_queue, mandates, surveillance, investigation_events, hint_state) plus
-- generated_assets metadata move behind SECURITY DEFINER functions here.
-- Exactly like 0007: additive only. Nothing here revokes any grant current
-- Production (ae2a2b0) depends on — Production does not call any function
-- in this file and keeps writing through the plain broad UPDATE it always
-- has. CONTRACT (0008, updated alongside this file) is what removes that
-- grant, and only once APP-2 is confirmed to be the sole writer.
--
-- Capability reuse: every function whose authoritative result requires
-- CaseTruth (regenerated in Next.js from seed+difficulty, never present in
-- Postgres) requires the SAME `CASELINE_S2_SERVER_CAPABILITY` validated by
-- caseline_check_server_capability() (0007) — no new secret introduced.
-- Functions whose validation is fully derivable from already-stored DB
-- state need no capability at all; each is labeled below.
--
-- No generic patch function exists anywhere in this file. Every function
-- takes narrow, purpose-specific arguments for one semantic operation —
-- never an arbitrary jsonb "new state" blob for a whole column.

-- ---------------------------------------------------------------------
-- Shared helper: append an event to an investigation_events array unless
-- an element with the same id already exists (mirrors events.ts#scheduleEvent's
-- own idempotency — same logical event requested twice is a no-op, never a
-- duplicate). Pure/immutable — no table access, usable inside any function
-- below without its own capability or ownership check.
-- ---------------------------------------------------------------------
create or replace function public.caseline_append_event_if_new(p_events jsonb, p_event jsonb)
returns jsonb
language sql
immutable
as $$
  select case
    when p_event is null then p_events
    when exists (select 1 from jsonb_array_elements(p_events) e where e ->> 'id' = p_event ->> 'id')
      then p_events
    else p_events || jsonb_build_array(p_event)
  end;
$$;

-- Bug found applying this migration live (same PUBLIC-default-grant class
-- as EXPAND-1's original finding): this helper had no explicit revoke/grant
-- of its own, so it inherited the implicit PUBLIC execute grant Postgres
-- gives every new function. Harmless in practice (pure, no table access,
-- no auth check needed — a stranger calling it directly gains nothing) but
-- fixed for consistency with every other function in this file, applied as
-- a follow-up statement live and folded back into this draft.
revoke all on function public.caseline_append_event_if_new(jsonb, jsonb) from public, anon;
grant execute on function public.caseline_append_event_if_new(jsonb, jsonb) to authenticated;

-- =======================================================================
-- 1. EVIDENCE / DISCOVERY
-- =======================================================================

-- AUTHENTICATED-SEMANTIC: "collected" only ever depends on the evidence
-- already being "discovered" — pure DB-state check, no CaseTruth needed.
-- Idempotent: no-op (not an error) if the evidence isn't currently
-- "discovered" (already collected, or never discovered).
create or replace function public.caseline_collect_evidence(p_session_uuid uuid, p_evidence_id text)
returns table (evidence_status jsonb)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_status jsonb;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'caseline: authentication required';
  end if;

  select s.evidence_status into v_status
    from public.investigation_sessions s
    where s.user_id = v_uid and s.session_uuid = p_session_uuid
    for update;
  if v_status is null then
    raise exception 'caseline: no matching active session';
  end if;

  if v_status ->> p_evidence_id is distinct from 'discovered' then
    return query select v_status;
    return;
  end if;

  v_status := jsonb_set(v_status, array[p_evidence_id], '"collected"');
  update public.investigation_sessions
    set evidence_status = v_status, updated_at = now()
    where user_id = v_uid and session_uuid = p_session_uuid;

  return query select v_status;
end;
$$;

revoke all on function public.caseline_collect_evidence(uuid, text) from public, anon;
grant execute on function public.caseline_collect_evidence(uuid, text) to authenticated;

-- SERVER-CAPABILITY-REQUIRED: Next.js has already filtered p_evidence_ids
-- against `truth.evidence` for the specific query the player made (crime
-- scene, interrogation, records check, ...) — this function only persists
-- that already-authoritative result. Monotonic: never downgrades an id
-- already at "collected"/"sent_to_lab"/"analyzed" back to "discovered".
-- p_event is optional pre-rendered, player-safe InvestigationEvent JSON
-- (e.g. a witness_callback becoming eligible) — never raw CaseTruth.
create or replace function public.caseline_reveal_evidence(
  p_server_token text,
  p_session_uuid uuid,
  p_evidence_ids jsonb,
  p_event jsonb default null
)
returns table (evidence_status jsonb, investigation_events jsonb)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_status jsonb;
  v_events jsonb;
  v_id text;
begin
  perform public.caseline_check_server_capability(p_server_token);

  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'caseline: authentication required';
  end if;
  if jsonb_typeof(p_evidence_ids) is distinct from 'array' then
    raise exception 'caseline: p_evidence_ids must be a jsonb array';
  end if;

  select s.evidence_status, s.investigation_events into v_status, v_events
    from public.investigation_sessions s
    where s.user_id = v_uid and s.session_uuid = p_session_uuid
    for update;
  if v_status is null then
    raise exception 'caseline: no matching active session';
  end if;

  for v_id in select jsonb_array_elements_text(p_evidence_ids) loop
    if v_status ->> v_id is null then
      v_status := jsonb_set(v_status, array[v_id], '"discovered"');
    end if;
  end loop;

  v_events := public.caseline_append_event_if_new(v_events, p_event);

  update public.investigation_sessions
    set evidence_status = v_status, investigation_events = v_events, updated_at = now()
    where user_id = v_uid and session_uuid = p_session_uuid;

  return query select v_status, v_events;
end;
$$;

revoke all on function public.caseline_reveal_evidence(text, uuid, jsonb, jsonb) from public, anon;
grant execute on function public.caseline_reveal_evidence(text, uuid, jsonb, jsonb) to authenticated;

-- =======================================================================
-- 2. LAB
-- =======================================================================

-- SERVER-CAPABILITY-REQUIRED: p_analysis_type/p_ready_at are computed in
-- Next.js from `truth.evidence` (LAB_ANALYSIS_DURATION_MINUTES lookup) —
-- this function cannot re-derive them without CaseTruth, only sanity-check
-- and persist them. Idempotent: a second submit for an evidence id already
-- "sent_to_lab"/"analyzed" is a no-op.
create or replace function public.caseline_submit_to_lab(
  p_server_token text,
  p_session_uuid uuid,
  p_evidence_id text,
  p_analysis_type text,
  p_ready_at integer,
  p_event jsonb default null
)
returns table (lab_queue jsonb, evidence_status jsonb, investigation_events jsonb)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_queue jsonb;
  v_status jsonb;
  v_events jsonb;
  v_now integer;
begin
  perform public.caseline_check_server_capability(p_server_token);

  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'caseline: authentication required';
  end if;

  select s.lab_queue, s.evidence_status, s.investigation_events, s.current_time_minutes
    into v_queue, v_status, v_events, v_now
    from public.investigation_sessions s
    where s.user_id = v_uid and s.session_uuid = p_session_uuid
    for update;
  if v_queue is null then
    raise exception 'caseline: no matching active session';
  end if;
  if p_ready_at < v_now then
    -- Sanity bound, not a game-rule change (mirrors caseline_finalize_case's
    -- p_xp_gained check) — catches a malformed/runaway caller, since a real
    -- lab job never completes before it was submitted.
    raise exception 'caseline: implausible lab ready time';
  end if;

  if v_status ->> p_evidence_id in ('sent_to_lab', 'analyzed') then
    return query select v_queue, v_status, v_events;
    return;
  end if;

  v_status := jsonb_set(v_status, array[p_evidence_id], '"sent_to_lab"');
  v_queue := v_queue || jsonb_build_array(jsonb_build_object(
    'evidenceId', p_evidence_id,
    'analysisType', p_analysis_type,
    'submittedAt', v_now,
    'readyAt', p_ready_at
  ));
  v_events := public.caseline_append_event_if_new(v_events, p_event);

  update public.investigation_sessions
    set lab_queue = v_queue, evidence_status = v_status, investigation_events = v_events, updated_at = now()
    where user_id = v_uid and session_uuid = p_session_uuid;

  return query select v_queue, v_status, v_events;
end;
$$;

revoke all on function public.caseline_submit_to_lab(text, uuid, text, text, integer, jsonb) from public, anon;
grant execute on function public.caseline_submit_to_lab(text, uuid, text, text, integer, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Shared helper: given already-fetched lab_queue/evidence_status/
-- investigation_events and the new current_time_minutes, completes any due
-- lab job and flips any due event to "ready". Pure/immutable — no table
-- access — factored out so both caseline_advance_time (player-facing,
-- fixed 30/60/240 delays) and caseline_advance_time_internal (server-
-- computed small action costs, e.g. a 5-minute interrogation) share the
-- exact same completion logic instead of two copies drifting apart.
-- ---------------------------------------------------------------------
create or replace function public.caseline_apply_time_effects(p_lab_queue jsonb, p_evidence_status jsonb, p_investigation_events jsonb, p_new_time integer)
returns table (evidence_status jsonb, investigation_events jsonb)
language plpgsql
immutable
as $$
declare
  v_status jsonb := p_evidence_status;
  v_events jsonb;
  v_job jsonb;
begin
  for v_job in select jsonb_array_elements(p_lab_queue) loop
    if (v_job ->> 'readyAt')::int <= p_new_time
       and v_status ->> (v_job ->> 'evidenceId') = 'sent_to_lab' then
      v_status := jsonb_set(v_status, array[v_job ->> 'evidenceId'], '"analyzed"');
    end if;
  end loop;

  select coalesce(jsonb_agg(
    case
      when (e ->> 'status') = 'scheduled' and (e ->> 'scheduledAt')::int <= p_new_time
        then jsonb_set(e, '{status}', '"ready"')
      else e
    end
  ), '[]'::jsonb)
  into v_events
  from jsonb_array_elements(p_investigation_events) e;

  return query select v_status, v_events;
end;
$$;

revoke all on function public.caseline_apply_time_effects(jsonb, jsonb, jsonb, integer) from public, anon;
grant execute on function public.caseline_apply_time_effects(jsonb, jsonb, jsonb, integer) to authenticated;

-- ---------------------------------------------------------------------
-- caseline_advance_time — SUPERSEDES the EXPAND-1 version with the SAME
-- signature (p_session_uuid, p_minutes) but an extended return shape, so it
-- must be DROPped first (CREATE OR REPLACE cannot change a function's
-- return type). Still AUTHENTICATED-SEMANTIC: completing a lab job or
-- flipping an event to "ready" needs only already-stored DB state
-- (current_time_minutes vs. readyAt/scheduledAt), never CaseTruth — this is
-- exactly the gap the audit flagged as the weakest link (a direct-REST
-- attacker could forge lab_queue/investigation_events wholesale; now that
-- lab_queue/investigation_events are ONLY ever written by capability-gated
-- functions above and this one, that forgery surface is closed once
-- CONTRACT revokes the plain UPDATE grant).
--
-- This is exclusively the player-facing TopBar clock (allow-list matches
-- components/shell/TopBar.tsx exactly, verified by the structural test).
-- Small, server-computed action costs (interrogation, phone/vehicle/bank
-- lookups, executing a granted search warrant, ...) never went through
-- this allow-list even before EXPAND-2 — they were a separate, unchecked
-- local `discovery.advanceTime` mutation persisted by the old broad
-- `saveSession`. EXPAND-2 closes that gap with a SEPARATE function,
-- caseline_advance_time_internal below, rather than widening this one's
-- allow-list to include costs a player never directly triggers by clicking
-- a time button — conflating the two would make this function's allow-list
-- no longer mean "exactly the UI buttons".
--
-- Backward compatible with the existing APP-1 caller
-- (`SupabaseSessionStore#advanceTime`, which only reads the
-- `current_time_minutes` field of the returned row) — extra columns are
-- additive from a JS destructuring caller's point of view.
-- ---------------------------------------------------------------------
drop function if exists public.caseline_advance_time(uuid, integer);

create or replace function public.caseline_advance_time(p_session_uuid uuid, p_minutes integer)
returns table (current_time_minutes integer, evidence_status jsonb, investigation_events jsonb)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_new_time integer;
  v_queue jsonb;
  v_status jsonb;
  v_events jsonb;
  v_effects record;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'caseline: authentication required';
  end if;
  if p_minutes not in (30, 60, 240) then
    raise exception 'caseline: invalid time delta';
  end if;

  update public.investigation_sessions s
    set current_time_minutes = s.current_time_minutes + p_minutes, updated_at = now()
    where s.user_id = v_uid and s.session_uuid = p_session_uuid
    returning s.current_time_minutes, s.lab_queue, s.evidence_status, s.investigation_events
    into v_new_time, v_queue, v_status, v_events;
  if not found then
    raise exception 'caseline: no matching active session';
  end if;

  select * into v_effects from public.caseline_apply_time_effects(v_queue, v_status, v_events, v_new_time);

  update public.investigation_sessions
    set evidence_status = v_effects.evidence_status, investigation_events = v_effects.investigation_events, updated_at = now()
    where user_id = v_uid and session_uuid = p_session_uuid;

  return query select v_new_time, v_effects.evidence_status, v_effects.investigation_events;
end;
$$;

revoke all on function public.caseline_advance_time(uuid, integer) from public, anon;
grant execute on function public.caseline_advance_time(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------
-- caseline_advance_time_internal — the small, fixed, server-computed time
-- costs baked into other actions (never a player-chosen value): 3
-- (vehicle lookup), 4 (criminal record lookup), 5 (interrogation question,
-- confrontation, phone lookup), 20 (executing a granted search warrant).
-- AUTHENTICATED-SEMANTIC, same as caseline_advance_time — no CaseTruth
-- needed, only the fixed allow-list below (a sanity bound matching the
-- literal constants call sites use today, not an open range).
-- ---------------------------------------------------------------------
create or replace function public.caseline_advance_time_internal(p_session_uuid uuid, p_minutes integer)
returns table (current_time_minutes integer, evidence_status jsonb, investigation_events jsonb)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_new_time integer;
  v_queue jsonb;
  v_status jsonb;
  v_events jsonb;
  v_effects record;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'caseline: authentication required';
  end if;
  if p_minutes not in (3, 4, 5, 20) then
    raise exception 'caseline: invalid internal time cost';
  end if;

  update public.investigation_sessions s
    set current_time_minutes = s.current_time_minutes + p_minutes, updated_at = now()
    where s.user_id = v_uid and s.session_uuid = p_session_uuid
    returning s.current_time_minutes, s.lab_queue, s.evidence_status, s.investigation_events
    into v_new_time, v_queue, v_status, v_events;
  if not found then
    raise exception 'caseline: no matching active session';
  end if;

  select * into v_effects from public.caseline_apply_time_effects(v_queue, v_status, v_events, v_new_time);

  update public.investigation_sessions
    set evidence_status = v_effects.evidence_status, investigation_events = v_effects.investigation_events, updated_at = now()
    where user_id = v_uid and session_uuid = p_session_uuid;

  return query select v_new_time, v_effects.evidence_status, v_effects.investigation_events;
end;
$$;

revoke all on function public.caseline_advance_time_internal(uuid, integer) from public, anon;
grant execute on function public.caseline_advance_time_internal(uuid, integer) to authenticated;

-- =======================================================================
-- 3. MANDATES / WARRANTS
-- =======================================================================

-- SERVER-CAPABILITY-REQUIRED: `p_granted`/`p_reason` are the output of
-- `evaluateMandate(truth, ...)`, which needs `truth.evidence` — this
-- function cannot re-derive the decision, only persist it exactly once per
-- key. The ESLint rule around `MandateRecord.granted` protects only this
-- codebase's own reads; this is the actual database-level protection the
-- audit found missing (a direct REST UPDATE could set `granted: true`
-- freely). Idempotent: a mandate already decided for this key is never
-- re-decided — `evaluateMandate` is only ever meaningful the instant the
-- player first requests it, since it depends on evidence discovered *at
-- that moment* (mirrors the real gameplay rule, not just a DB nicety).
create or replace function public.caseline_request_mandate(
  p_server_token text,
  p_session_uuid uuid,
  p_key text,
  p_granted boolean,
  p_reason text,
  p_requested_at integer,
  p_event jsonb default null
)
returns table (mandates jsonb, investigation_events jsonb)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_mandates jsonb;
  v_events jsonb;
begin
  perform public.caseline_check_server_capability(p_server_token);

  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'caseline: authentication required';
  end if;

  select s.mandates, s.investigation_events into v_mandates, v_events
    from public.investigation_sessions s
    where s.user_id = v_uid and s.session_uuid = p_session_uuid
    for update;
  if v_mandates is null then
    raise exception 'caseline: no matching active session';
  end if;

  if v_mandates ? p_key then
    return query select v_mandates, v_events;
    return;
  end if;

  v_mandates := jsonb_set(v_mandates, array[p_key], jsonb_build_object(
    'key', p_key, 'granted', p_granted, 'reason', p_reason, 'requestedAt', p_requested_at
  ));
  v_events := public.caseline_append_event_if_new(v_events, p_event);

  update public.investigation_sessions
    set mandates = v_mandates, investigation_events = v_events, updated_at = now()
    where user_id = v_uid and session_uuid = p_session_uuid;

  return query select v_mandates, v_events;
end;
$$;

revoke all on function public.caseline_request_mandate(text, uuid, text, boolean, text, integer, jsonb) from public, anon;
grant execute on function public.caseline_request_mandate(text, uuid, text, boolean, text, integer, jsonb) to authenticated;

-- =======================================================================
-- 4. SURVEILLANCE
-- =======================================================================

-- SERVER-CAPABILITY-REQUIRED: p_record is the full SurveillanceRecord
-- (including `observations`) computed by `projectSurveillanceObservations`
-- against `truth.postCrimeMovements` — pure derived content, but content
-- this function cannot verify without CaseTruth. Idempotent on the
-- `personId:startedAt` key, exactly like the in-process `startSurveillance`
-- already behaves (a request is decided once, at request time).
create or replace function public.caseline_start_surveillance(
  p_server_token text,
  p_session_uuid uuid,
  p_key text,
  p_record jsonb,
  p_event jsonb default null
)
returns table (surveillance jsonb, investigation_events jsonb)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_surveillance jsonb;
  v_events jsonb;
begin
  perform public.caseline_check_server_capability(p_server_token);

  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'caseline: authentication required';
  end if;

  select s.surveillance, s.investigation_events into v_surveillance, v_events
    from public.investigation_sessions s
    where s.user_id = v_uid and s.session_uuid = p_session_uuid
    for update;
  if v_surveillance is null then
    raise exception 'caseline: no matching active session';
  end if;

  if v_surveillance ? p_key then
    return query select v_surveillance, v_events;
    return;
  end if;

  v_surveillance := jsonb_set(v_surveillance, array[p_key], p_record);
  v_events := public.caseline_append_event_if_new(v_events, p_event);

  update public.investigation_sessions
    set surveillance = v_surveillance, investigation_events = v_events, updated_at = now()
    where user_id = v_uid and session_uuid = p_session_uuid;

  return query select v_surveillance, v_events;
end;
$$;

revoke all on function public.caseline_start_surveillance(text, uuid, text, jsonb, jsonb) from public, anon;
grant execute on function public.caseline_start_surveillance(text, uuid, text, jsonb, jsonb) to authenticated;

-- =======================================================================
-- 5. HINT STATE (authoritative usage/penalty — NOT the `hintsDisabled`
-- profile preference, which is already S2-safe via
-- caseline_update_profile_preferences)
-- =======================================================================

-- SERVER-CAPABILITY-REQUIRED: hint eligibility/text is computed by
-- `computeHintOpportunities(truth, session)` — this function only persists
-- the escalation and enforces the "only escalations count" rule
-- server-side (a forged direct write today can zero out
-- totalHintsUsed/progress, laundering the scoring penalty computed by
-- computeHintPenalty at accusation time). Idempotent: escalating to a level
-- at or below the already-recorded progress for that hint id is a no-op.
create or replace function public.caseline_record_hint(
  p_server_token text,
  p_session_uuid uuid,
  p_hint_id text,
  p_level integer,
  p_history_entry jsonb
)
returns table (hint_state jsonb)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_state jsonb;
  v_progress jsonb;
  v_history jsonb;
  v_total integer;
  v_existing integer;
begin
  perform public.caseline_check_server_capability(p_server_token);

  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'caseline: authentication required';
  end if;
  if p_level not in (1, 2, 3) then
    raise exception 'caseline: invalid hint level';
  end if;

  select s.hint_state into v_state
    from public.investigation_sessions s
    where s.user_id = v_uid and s.session_uuid = p_session_uuid
    for update;
  if v_state is null then
    raise exception 'caseline: no matching active session';
  end if;

  v_progress := coalesce(v_state -> 'progress', '{}'::jsonb);
  v_history := coalesce(v_state -> 'history', '[]'::jsonb);
  v_total := coalesce((v_state ->> 'totalHintsUsed')::int, 0);
  v_existing := coalesce((v_progress ->> p_hint_id)::int, 0);

  if p_level <= v_existing then
    return query select v_state;
    return;
  end if;

  v_progress := jsonb_set(v_progress, array[p_hint_id], to_jsonb(p_level));
  v_history := v_history || jsonb_build_array(p_history_entry);
  v_total := v_total + 1;
  v_state := jsonb_build_object('progress', v_progress, 'history', v_history, 'totalHintsUsed', v_total);

  update public.investigation_sessions
    set hint_state = v_state, updated_at = now()
    where user_id = v_uid and session_uuid = p_session_uuid;

  return query select v_state;
end;
$$;

revoke all on function public.caseline_record_hint(text, uuid, text, integer, jsonb) from public, anon;
grant execute on function public.caseline_record_hint(text, uuid, text, integer, jsonb) to authenticated;

-- =======================================================================
-- 6. INVESTIGATION EVENTS — the one player-triggered mutation not covered
-- by an "outcome" function above (marking a *already-ready* event as seen
-- is pure UI acknowledgement, not a reveal).
-- =======================================================================

-- AUTHENTICATED-SEMANTIC: only allows "ready" -> "seen", never
-- "scheduled" -> "seen" (skipping the time gate) and never touches
-- payload/scheduledAt — pure DB-state check, no CaseTruth needed.
create or replace function public.caseline_mark_event_seen(p_session_uuid uuid, p_event_id text)
returns table (investigation_events jsonb)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_events jsonb;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'caseline: authentication required';
  end if;

  select s.investigation_events into v_events
    from public.investigation_sessions s
    where s.user_id = v_uid and s.session_uuid = p_session_uuid
    for update;
  if v_events is null then
    raise exception 'caseline: no matching active session';
  end if;

  select coalesce(jsonb_agg(
    case
      when (e ->> 'id') = p_event_id and (e ->> 'status') = 'ready'
        then jsonb_set(e, '{status}', '"seen"')
      else e
    end
  ), '[]'::jsonb)
  into v_events
  from jsonb_array_elements(v_events) e;

  update public.investigation_sessions
    set investigation_events = v_events, updated_at = now()
    where user_id = v_uid and session_uuid = p_session_uuid;

  return query select v_events;
end;
$$;

revoke all on function public.caseline_mark_event_seen(uuid, text) from public, anon;
grant execute on function public.caseline_mark_event_seen(uuid, text) to authenticated;

-- =======================================================================
-- 6b. SEED RESEAL (S1 compatibility) — the one remaining direct
-- authenticated write over `investigation_sessions.seed` that CONTRACT must
-- also close. Next.js does ALL the cryptography (decrypting/verifying the
-- expected envelope, computing the new one) — this function never sees a
-- plaintext seed, only two opaque strings (the currently-stored value and
-- the new one to compare-and-swap in), and is a pure ownership+identity
-- scoped compare-and-swap, mirroring `SessionSeedColumnOps.compareAndSwapSeed`
-- (session-seed.ts) exactly.
--
-- SERVER-CAPABILITY-REQUIRED even though no CaseTruth is involved: a plain
-- authenticated-callable compare-and-swap would let a player replace their
-- own stored envelope with ANY ciphertext blob of their choosing (the
-- function has no way to verify a caller-supplied "new seed" is genuinely a
-- reseal of the SAME logical plaintext without decrypting it, which
-- requires K_seed — only ever held in Next.js). The capability check proves
-- this call carries a value Next.js already verified, exactly the same
-- trust argument as `caseline_finalize_case`'s score/XP.
--
-- Idempotent: if `p_expected_seed` no longer matches (a concurrent reseal
-- already won, or this is a harmless retry), returns whatever is currently
-- stored rather than erroring — a retried reseal is a no-op, never a
-- corruption. Scoped by BOTH `user_id` and `session_uuid`, so this can
-- never touch a different investigation instance's seed, even a past one
-- for the same user (case_history.seed is a separate column, untouched).
-- =======================================================================
create or replace function public.caseline_reseal_seed(
  p_server_token text,
  p_session_uuid uuid,
  p_expected_seed text,
  p_new_seed text
)
returns table (seed text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_seed text;
begin
  perform public.caseline_check_server_capability(p_server_token);

  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'caseline: authentication required';
  end if;

  update public.investigation_sessions s
    set seed = p_new_seed, updated_at = now()
    where s.user_id = v_uid and s.session_uuid = p_session_uuid and s.seed = p_expected_seed
    returning s.seed into v_seed;

  if not found then
    select s.seed into v_seed from public.investigation_sessions s where s.user_id = v_uid and s.session_uuid = p_session_uuid;
    if v_seed is null then
      raise exception 'caseline: no matching active session';
    end if;
  end if;

  return query select v_seed;
end;
$$;

revoke all on function public.caseline_reseal_seed(text, uuid, text, text) from public, anon;
grant execute on function public.caseline_reseal_seed(text, uuid, text, text) to authenticated;

-- =======================================================================
-- 7. GENERATED ART METADATA (generated_assets table — NOT Storage; see
-- SECURITY.md §S2 "Storage architecture" for why Storage itself cannot be
-- closed this way and remains explicitly unresolved/deferred).
--
-- Every one of these is only ever called from trusted server code (a
-- background `after()` callback or the S1 lazy-migration path, never a
-- client-chosen semantic action) — there is no player input to validate
-- against CaseTruth, but routing through the S2 capability closes off
-- direct-REST forgery uniformly rather than leaving this table on a
-- separate, weaker "ownership only" trust level than everything above.
-- =======================================================================

create or replace function public.caseline_ga_create_queued(
  p_server_token text,
  p_case_seed text,
  p_asset_kind text,
  p_descriptor_hash text,
  p_generation_version integer,
  p_provider text,
  p_reuse_key text default null
)
returns table (id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_id uuid;
begin
  perform public.caseline_check_server_capability(p_server_token);
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'caseline: authentication required';
  end if;

  insert into public.generated_assets
    (user_id, case_seed, asset_kind, descriptor_hash, generation_version, provider, status, reuse_key)
  values
    (v_uid, p_case_seed, p_asset_kind, p_descriptor_hash, p_generation_version, p_provider, 'queued', p_reuse_key)
  on conflict (user_id, descriptor_hash, generation_version, provider)
    do update set updated_at = now()
  returning generated_assets.id into v_id;

  return query select v_id;
end;
$$;

revoke all on function public.caseline_ga_create_queued(text, text, text, text, integer, text, text) from public, anon;
grant execute on function public.caseline_ga_create_queued(text, text, text, text, integer, text, text) to authenticated;

create or replace function public.caseline_ga_create_reused(
  p_server_token text,
  p_case_seed text,
  p_asset_kind text,
  p_descriptor_hash text,
  p_generation_version integer,
  p_provider text,
  p_provider_model text,
  p_reuse_key text,
  p_storage_path text,
  p_width integer,
  p_height integer,
  p_prompt_version integer,
  p_source_asset_id uuid
)
returns table (id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_id uuid;
begin
  perform public.caseline_check_server_capability(p_server_token);
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'caseline: authentication required';
  end if;
  -- The reuse source must be this same user's own canonical row — a
  -- cross-user reuse pointer would let a player's row reference another
  -- user's private storage_path.
  if not exists (
    select 1 from public.generated_assets
    where id = p_source_asset_id and user_id = v_uid and source_asset_id is null
  ) then
    raise exception 'caseline: invalid reuse source';
  end if;

  insert into public.generated_assets
    (user_id, case_seed, asset_kind, descriptor_hash, generation_version, provider, provider_model, status,
     reuse_key, storage_path, width, height, prompt_version, source_asset_id)
  values
    (v_uid, p_case_seed, p_asset_kind, p_descriptor_hash, p_generation_version, p_provider, p_provider_model, 'ready',
     p_reuse_key, p_storage_path, p_width, p_height, p_prompt_version, p_source_asset_id)
  on conflict (user_id, descriptor_hash, generation_version, provider)
    do update set updated_at = now()
  returning generated_assets.id into v_id;

  perform public.increment_reuse_count(p_source_asset_id, v_uid);

  return query select v_id;
end;
$$;

revoke all on function public.caseline_ga_create_reused(text, text, text, text, integer, text, text, text, text, integer, integer, integer, uuid) from public, anon;
grant execute on function public.caseline_ga_create_reused(text, text, text, text, integer, text, text, text, text, integer, integer, integer, uuid) to authenticated;

create or replace function public.caseline_ga_mark_generating(p_server_token text, p_asset_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_uid uuid;
begin
  perform public.caseline_check_server_capability(p_server_token);
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'caseline: authentication required';
  end if;
  update public.generated_assets
    set status = 'generating', updated_at = now()
    where id = p_asset_id and user_id = v_uid;
end;
$$;

revoke all on function public.caseline_ga_mark_generating(text, uuid) from public, anon;
grant execute on function public.caseline_ga_mark_generating(text, uuid) to authenticated;

create or replace function public.caseline_ga_mark_ready(
  p_server_token text,
  p_asset_id uuid,
  p_storage_path text,
  p_width integer,
  p_height integer,
  p_provider_model text,
  p_prompt_version integer
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_uid uuid;
begin
  perform public.caseline_check_server_capability(p_server_token);
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'caseline: authentication required';
  end if;
  update public.generated_assets
    set status = 'ready', storage_path = p_storage_path, width = p_width, height = p_height,
        provider_model = p_provider_model, prompt_version = p_prompt_version, updated_at = now()
    where id = p_asset_id and user_id = v_uid;
end;
$$;

revoke all on function public.caseline_ga_mark_ready(text, uuid, text, integer, integer, text, integer) from public, anon;
grant execute on function public.caseline_ga_mark_ready(text, uuid, text, integer, integer, text, integer) to authenticated;

create or replace function public.caseline_ga_mark_failed(p_server_token text, p_asset_id uuid, p_error_message text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_uid uuid;
begin
  perform public.caseline_check_server_capability(p_server_token);
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'caseline: authentication required';
  end if;
  update public.generated_assets
    set status = 'failed', error_message = p_error_message,
        attempt_count = attempt_count + 1, failed_at = now(), updated_at = now()
    where id = p_asset_id and user_id = v_uid;
end;
$$;

revoke all on function public.caseline_ga_mark_failed(text, uuid, text) from public, anon;
grant execute on function public.caseline_ga_mark_failed(text, uuid, text) to authenticated;

-- S1 lazy-migration helpers (legacy-case-migration.ts). Signatures mirror
-- the existing TypeScript ops exactly (`repointStoragePath(userId, fromPath,
-- toPath)` matches by `storage_path`, not a single row id — a reused row
-- can share the same legacy `storage_path` as its canonical source, so more
-- than one row may legitimately need repointing in one call;
-- `relabelRow(userId, id, fromCaseKey, toCaseKey)` additionally guards on
-- the row still carrying the OLD case key, so a retried/duplicate call is a
-- harmless no-op rather than an unconditional overwrite).
create or replace function public.caseline_ga_repoint_path(p_server_token text, p_from_path text, p_to_path text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_uid uuid;
begin
  perform public.caseline_check_server_capability(p_server_token);
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'caseline: authentication required';
  end if;
  update public.generated_assets
    set storage_path = p_to_path, updated_at = now()
    where user_id = v_uid and storage_path = p_from_path;
end;
$$;

revoke all on function public.caseline_ga_repoint_path(text, text, text) from public, anon;
grant execute on function public.caseline_ga_repoint_path(text, text, text) to authenticated;

create or replace function public.caseline_ga_relabel(p_server_token text, p_asset_id uuid, p_from_case_key text, p_to_case_key text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_uid uuid;
begin
  perform public.caseline_check_server_capability(p_server_token);
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'caseline: authentication required';
  end if;
  update public.generated_assets
    set case_seed = p_to_case_key, updated_at = now()
    where id = p_asset_id and user_id = v_uid and case_seed = p_from_case_key;
end;
$$;

revoke all on function public.caseline_ga_relabel(text, uuid, text, text) from public, anon;
grant execute on function public.caseline_ga_relabel(text, uuid, text, text) to authenticated;

-- =======================================================================
-- 8. STORAGE — deliberately NOT addressed by this migration.
--
-- Every function above solves the "authoritative TypeScript result vs.
-- ownership-only RLS" gap for Postgres TABLE data. Supabase Storage object
-- upload/move/delete is a *separate* service that authorizes purely via
-- `storage.objects` RLS evaluated against the caller's own JWT — a
-- PostgreSQL SECURITY DEFINER function has no mechanism to elevate a
-- Storage REST call's privilege, because the object bytes never pass
-- through a SQL function body at all (see SECURITY.md §S2 "Storage
-- architecture"). This is the explicitly unresolved item flagged in the
-- EXPAND-2 return report — no Storage policy change is included here, and
-- none should be applied until that design question has explicit user
-- sign-off (a new privileged credential may be required).
-- =======================================================================
