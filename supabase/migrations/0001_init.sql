-- CASELINE — initial schema (Phase 9)
--
-- Deliberately does NOT store CaseTruth anywhere. Every table here holds
-- only: (a) a case seed + difficulty (cheap and deterministic to
-- regenerate server-side, see ARCHITECTURE.md#determinism), and (b) play
-- state the player themselves produced (discovered evidence ids, their own
-- notes/timeline/board, an accusation they submitted, a score computed
-- *after* the fact). There is no column, anywhere, for culpritId, hidden
-- roles, truthfulness, or undiscovered evidence — there is nothing to leak
-- because the secret state is never written to Postgres in the first place.

-- ---------------------------------------------------------------------
-- profiles — one row per authenticated player, created automatically on
-- sign-up (see the trigger at the bottom of this file).
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  rank text not null default 'Recrue',
  xp integer not null default 0,
  cases_solved integer not null default 0,
  cases_failed integer not null default 0,
  accusations_total integer not null default 0,
  sound_muted boolean not null default false,
  reduce_motion boolean not null default false,
  hints_disabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);

-- ---------------------------------------------------------------------
-- investigation_sessions — the ONE active, resumable case per player.
-- Mirrors lib/game-session/types.ts#GameSession field for field; jsonb
-- columns hold the same shapes the client already works with in memory.
-- ---------------------------------------------------------------------
create table if not exists public.investigation_sessions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  seed text not null,
  difficulty text not null,
  current_time_minutes integer not null,
  evidence_status jsonb not null default '{}'::jsonb,
  lab_queue jsonb not null default '[]'::jsonb,
  notes text not null default '',
  player_timeline jsonb not null default '[]'::jsonb,
  interrogated jsonb not null default '{}'::jsonb,
  mandates jsonb not null default '{}'::jsonb,
  board jsonb not null default '{"nodes":[],"edges":[]}'::jsonb,
  accusation jsonb,
  crime_scene_examined boolean not null default false,
  crime_scene_inspected_zone_ids jsonb not null default '[]'::jsonb,
  last_action_message text,
  last_revealed_evidence_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.investigation_sessions enable row level security;

create policy "sessions_select_own" on public.investigation_sessions
  for select using (auth.uid() = user_id);
create policy "sessions_insert_own" on public.investigation_sessions
  for insert with check (auth.uid() = user_id);
create policy "sessions_update_own" on public.investigation_sessions
  for update using (auth.uid() = user_id);
create policy "sessions_delete_own" on public.investigation_sessions
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- case_history — completed cases, kept after the active session row is
-- cleared, so the case-history screen and a resumed report view have
-- something to read (the accusation the player made and the score they
-- were given — never the underlying truth, which is re-derived from
-- `seed` + `difficulty` on demand, same as an active case).
-- ---------------------------------------------------------------------
create table if not exists public.case_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  seed text not null,
  difficulty text not null,
  accusation jsonb not null,
  score jsonb not null,
  completed_at timestamptz not null default now()
);

alter table public.case_history enable row level security;

create policy "case_history_select_own" on public.case_history
  for select using (auth.uid() = user_id);
create policy "case_history_insert_own" on public.case_history
  for insert with check (auth.uid() = user_id);

create index if not exists case_history_user_completed_idx
  on public.case_history (user_id, completed_at desc);

-- ---------------------------------------------------------------------
-- Auto-create a profile row the moment someone signs up, so the app never
-- has to handle "authenticated but no profile yet" as a special case.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
