-- CASELINE — Security S2, EXPAND phase (DRAFT — NOT YET APPLIED)
--
-- Adds the trusted mutation boundary without removing any privilege current
-- Production (ae2a2b0) depends on. After this migration, Production keeps
-- working exactly as before — it does not call any of these functions yet.
-- Nothing here revokes the existing broad `auth.uid() = user_id` policies;
-- that happens only in the separate CONTRACT migration, after the S2
-- application is confirmed to be the only thing writing this database.
--
-- ---------------------------------------------------------------------
-- Why SECURITY DEFINER functions, not a service-role client (see
-- SECURITY.md §S2): every function below still derives the caller's
-- identity from auth.uid() and scopes its writes to that same user's own
-- row — it does not bypass per-user ownership, only the *column-level*
-- restriction CONTRACT will add. A leaked capability token (see below)
-- lets someone call these functions with a self-chosen authoritative
-- result, but never touch another user's row: ownership is enforced
-- inside the function body from auth.uid(), never from a caller-supplied
-- id. That is a materially smaller blast radius than service_role, which
-- would bypass RLS (and per-user scoping) entirely.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- 1. Investigation-instance identity.
--
-- investigation_sessions is a 1-row-per-user table: the same physical row
-- is reused (upserted) across every case a player ever starts, so
-- `user_id` alone cannot distinguish "this investigation" from "the
-- player's next one" for idempotency purposes. `session_uuid` is a fresh
-- identifier assigned by trusted server code every time a new case
-- starts, and is what case_history links back to.
--
-- Volatile default (gen_random_uuid()) — unlike the constant defaults
-- used everywhere else in this schema, this one *does* require Postgres
-- to write a value into every existing row (a full table rewrite). Safe
-- here given table size (DATABASE.md: "hundreds of cases, not millions");
-- flagged for visibility, not because it's expected to be slow.
-- ---------------------------------------------------------------------
alter table public.investigation_sessions
  add column if not exists session_uuid uuid not null default gen_random_uuid();

-- ---------------------------------------------------------------------
-- 2. case_history — link back to the investigation instance that
-- produced it, and make re-archiving the same instance structurally
-- impossible (idempotency at the schema level, not just application
-- logic).
--
-- Nullable + a PARTIAL unique index (not a plain UNIQUE column) is
-- deliberate: every row that exists today has no way to populate this
-- column (it references an identity that didn't exist when they were
-- written) and will simply stay NULL. NULL is never considered equal to
-- NULL by a unique index, so historical rows can never violate this
-- constraint regardless of any duplicate `seed` values already in
-- Production — this migration does not need to audit or assume anything
-- about existing case_history contents to be safe. Only new rows written
-- by caseline_finalize_case() (below) ever populate this column, and
-- exactly one such row can ever exist per session_uuid.
-- ---------------------------------------------------------------------
alter table public.case_history
  add column if not exists source_session_uuid uuid;

create unique index if not exists case_history_source_session_uuid_key
  on public.case_history (source_session_uuid)
  where source_session_uuid is not null;

-- ---------------------------------------------------------------------
-- 3. Server capability — the piece that closes the gap plain SECURITY
-- DEFINER + auth.uid() cannot close on its own (see SECURITY.md §S2
-- "capability model"): score/grade/XP are computed in TypeScript from a
-- regenerated CaseTruth that never exists in Postgres, so no function
-- body here can independently verify a caller-supplied score is genuine.
-- auth.uid() alone proves *whose* row is being written, never *who is
-- allowed to dictate the authoritative result written to it*.
--
-- This table holds only a SHA-256 hash of a capability token — never the
-- token itself — so reading this table (even if RLS were misconfigured)
-- reveals nothing usable. RLS is enabled with zero policies, which is a
-- default-deny for every role including `authenticated`; only a
-- SECURITY DEFINER function body (which runs with the privileges of this
-- function's owner, not the caller) can read it.
--
-- The token itself lives only in a server-only Vercel environment
-- variable (see the interim report for the exact name/derivation) and is
-- never sent to the browser, logged, or stored in plaintext anywhere.
-- Populating `secret_hash` is a separate, out-of-band step — this
-- migration creates the empty table only; no secret material is embedded
-- in this file.
-- ---------------------------------------------------------------------
create table if not exists public.s2_server_capabilities (
  name text primary key,
  secret_hash text not null,
  created_at timestamptz not null default now()
);

alter table public.s2_server_capabilities enable row level security;
-- Deliberately no policies — default-deny for every role. Only a
-- SECURITY DEFINER function (see caseline_check_server_capability below)
-- can ever read this table.

revoke all on public.s2_server_capabilities from public, anon, authenticated;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Internal helper — not exposed to `authenticated`. Compares the caller-
-- supplied token against the stored hash. Raises if the capability is
-- unconfigured or the token doesn't match, so every caller (including a
-- misconfigured trusted server) fails closed rather than silently
-- degrading to "capability not required".
-- ---------------------------------------------------------------------
create or replace function public.caseline_check_server_capability(p_token text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hash text;
begin
  if p_token is null or length(p_token) < 32 then
    raise exception 'caseline: missing or malformed server capability token';
  end if;
  select secret_hash into v_hash
    from public.s2_server_capabilities
    where name = 'trusted_mutation_v1';
  if v_hash is null then
    raise exception 'caseline: server capability not configured';
  end if;
  if v_hash <> encode(digest(p_token, 'sha256'), 'hex') then
    raise exception 'caseline: invalid server capability token';
  end if;
end;
$$;

revoke all on function public.caseline_check_server_capability(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Player-callable, ownership-only functions (no server capability
-- needed — these only ever produce a result the player could already
-- reach through the existing UI, scoped to their own row).
-- ---------------------------------------------------------------------

-- Time advance: the allowed deltas are the actual gameplay rule (the UI
-- only ever offers +30/+60/+240 — see lib/game-session/actions.ts). The
-- function enforces that allow-list itself, so even a direct RPC call
-- cannot set the clock to an arbitrary value or a negative delta — unlike
-- today's `advanceTimeAction`/`discovery.advanceTime`, which currently
-- accept an unclamped `minutes` argument (a pre-existing, S2-independent
-- gap noted in the interim report). Lab-queue completion side effects
-- stay in application code (TypeScript, unchanged) — this function only
-- gates and persists the time value itself.
create or replace function public.caseline_advance_time(p_session_uuid uuid, p_minutes integer)
returns table (current_time_minutes integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'caseline: authentication required';
  end if;
  if p_minutes not in (30, 60, 240) then
    raise exception 'caseline: invalid time delta';
  end if;
  return query
    update public.investigation_sessions s
    set current_time_minutes = s.current_time_minutes + p_minutes,
        updated_at = now()
    where s.user_id = auth.uid() and s.session_uuid = p_session_uuid
    returning s.current_time_minutes;
  if not found then
    raise exception 'caseline: no matching active session';
  end if;
end;
$$;

grant execute on function public.caseline_advance_time(uuid, integer) to authenticated;

-- Profile preferences — the only profile columns a player may ever set
-- directly. xp/rank/cases_solved/cases_failed/accusations_total are
-- deliberately absent from this function's argument list; there is no
-- way to reach them through it.
create or replace function public.caseline_update_profile_preferences(
  p_sound_muted boolean default null,
  p_reduce_motion boolean default null,
  p_hints_disabled boolean default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'caseline: authentication required';
  end if;
  update public.profiles
  set sound_muted = coalesce(p_sound_muted, sound_muted),
      reduce_motion = coalesce(p_reduce_motion, reduce_motion),
      hints_disabled = coalesce(p_hints_disabled, hints_disabled),
      updated_at = now()
  where id = auth.uid();
end;
$$;

grant execute on function public.caseline_update_profile_preferences(boolean, boolean, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Server-capability-gated functions — the result they persist cannot
-- be independently verified from data already in Postgres (it depends on
-- a regenerated CaseTruth that only ever exists in the Next.js process),
-- so these require the trusted-server token in addition to auth.uid().
-- A direct REST caller has their own JWT but never this token (it is a
-- server-only Vercel environment variable, never sent to the browser),
-- so they cannot invoke these with a self-chosen result.
-- ---------------------------------------------------------------------

-- One case resolution, atomically: persists the accusation, inserts
-- exactly one case_history row, and updates profile progression, or does
-- nothing at all. The `accusation is null` guard inside the same UPDATE
-- that claims the session is what makes two concurrent calls resolve to
-- "exactly one winner" — Postgres's row-level lock on the UPDATE target
-- makes this atomic without an explicit SELECT ... FOR UPDATE or advisory
-- lock: a second transaction's UPDATE with the same WHERE clause simply
-- affects 0 rows once the first has committed its change to `accusation`.
create or replace function public.caseline_finalize_case(
  p_server_token text,
  p_session_uuid uuid,
  p_seed text,
  p_difficulty text,
  p_accusation jsonb,
  p_score jsonb,
  p_xp_gained integer,
  p_culprit_correct boolean
)
returns table (history_id uuid, already_finalized boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_claimed boolean;
  v_existing_id uuid;
  v_new_id uuid;
begin
  perform public.caseline_check_server_capability(p_server_token);

  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'caseline: authentication required';
  end if;
  if p_xp_gained < 0 or p_xp_gained > 500 then
    -- Sanity bound matching the real reward table (10-150 XP per case,
    -- see lib/game-session/career.ts) with headroom, not a game-rule
    -- change — catches a malformed/runaway caller, never a legitimate one.
    raise exception 'caseline: implausible xp_gained';
  end if;

  update public.investigation_sessions s
    set accusation = p_accusation, updated_at = now()
    where s.user_id = v_uid and s.session_uuid = p_session_uuid and s.accusation is null;
  get diagnostics v_claimed = row_count;
  v_claimed := (v_claimed::int > 0);

  if not v_claimed then
    -- Already finalized (or a stale/foreign session_uuid) — return the
    -- existing result instead of erroring, so a retried request is a
    -- harmless no-op rather than a surprise failure.
    select id into v_existing_id from public.case_history
      where source_session_uuid = p_session_uuid;
    return query select v_existing_id, true;
    return;
  end if;

  insert into public.case_history (user_id, seed, difficulty, accusation, score, source_session_uuid)
  values (v_uid, p_seed, p_difficulty, p_accusation, p_score, p_session_uuid)
  returning id into v_new_id;

  -- Mirrors lib/game-session/career.ts#RANKS exactly (kept in sync by
  -- hand — five thresholds, unlikely to change often; see the interim
  -- report for why `rank` stays a stored, derived-in-SQL column rather
  -- than being dropped in favor of a read-time-only computation, which
  -- would be a larger, unrelated schema change).
  update public.profiles
    set xp = xp + p_xp_gained,
        rank = case
          when xp + p_xp_gained >= 1500 then 'Commissaire'
          when xp + p_xp_gained >= 700 then 'Inspecteur principal'
          when xp + p_xp_gained >= 300 then 'Inspecteur'
          when xp + p_xp_gained >= 100 then 'Agent'
          else 'Recrue'
        end,
        cases_solved = cases_solved + (case when p_culprit_correct then 1 else 0 end),
        cases_failed = cases_failed + (case when p_culprit_correct then 0 else 1 end),
        accusations_total = accusations_total + 1,
        updated_at = now()
    where id = v_uid;

  return query select v_new_id, false;
end;
$$;

revoke all on function public.caseline_finalize_case(text, uuid, text, text, jsonb, jsonb, integer, boolean) from public, anon, authenticated;
-- Deliberately NOT granted to `authenticated` — see the interim report's
-- capability-model section for why this one function is reachable only
-- from trusted server code holding the capability token, never directly.
-- (Kept as a distinct statement, not folded into `create function`, so a
-- future migration can `grant`/`revoke` it independently without editing
-- this file.)
