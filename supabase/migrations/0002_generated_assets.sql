-- CASELINE — generated-art infrastructure (persistent asset cache)
--
-- Stores metadata for AI-generated case artwork (character portraits, crime
-- scene environments) plus a private Storage bucket for the image bytes
-- themselves. Same discipline as 0001_init.sql: no CaseTruth-only field
-- ever lands here (no culpritId, no roles, no motive, no staging) — only
-- `case_seed` (already public-safe elsewhere in this schema) and a
-- `descriptor_hash` that is itself just a hash of publicly-visible traits
-- (age bracket, hairstyle, location type, time of day, ...). The seed is
-- already enough to regenerate the exact same descriptor deterministically,
-- exactly like `investigation_sessions`/`case_history` rely on for `seed`.
--
-- Idempotent by design, same conventions as 0001_init.sql: `create table
-- if not exists`, `drop policy if exists` immediately before each
-- `create policy`, explicit `grant`s (required — see 0001_init.sql's note:
-- creating a table via the SQL Editor does not auto-grant `authenticated`
-- the table-level privilege the dashboard's table editor would).
--
-- No service-role client is introduced anywhere in this codebase by this
-- migration or the code that reads/writes this table — every read/write
-- still runs as the signed-in user, through RLS, from a normal
-- user-authenticated request (see GENERATED_ART.md).

-- ---------------------------------------------------------------------
-- generated_assets — one row per (user, descriptor, generation_version,
-- provider) combination. The unique constraint below is the "generate
-- once" guarantee: the same visual descriptor, at the same generation
-- version, from the same provider, is never generated twice for the same
-- user — a cache hit returns the existing row instead.
-- ---------------------------------------------------------------------
create table if not exists public.generated_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  case_seed text not null,
  -- 'character_portrait' | 'crime_scene_environment' today; extensible to
  -- future kinds without a schema change (plain text, not a Postgres enum,
  -- so adding a kind is a code-only change).
  asset_kind text not null,
  descriptor_hash text not null,
  generation_version integer not null,
  provider text not null,
  provider_model text,
  -- 'missing' | 'queued' | 'generating' | 'ready' | 'failed'
  status text not null default 'missing',
  storage_path text,
  width integer,
  height integer,
  prompt_version integer,
  error_message text,
  attempt_count integer not null default 0,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, descriptor_hash, generation_version, provider)
);

alter table public.generated_assets enable row level security;

drop policy if exists "generated_assets_select_own" on public.generated_assets;
create policy "generated_assets_select_own" on public.generated_assets
  for select using (auth.uid() = user_id);

drop policy if exists "generated_assets_insert_own" on public.generated_assets;
create policy "generated_assets_insert_own" on public.generated_assets
  for insert with check (auth.uid() = user_id);

drop policy if exists "generated_assets_update_own" on public.generated_assets;
create policy "generated_assets_update_own" on public.generated_assets
  for update using (auth.uid() = user_id);

-- No delete policy: generated assets are meant to be permanent for the
-- lifetime of a case, matching case_history's append-only style.

create index if not exists generated_assets_user_case_idx
  on public.generated_assets (user_id, case_seed);

grant select, insert, update on public.generated_assets to authenticated;

-- ---------------------------------------------------------------------
-- Storage — the project's first bucket. Private (not public): every read
-- goes through a short-lived signed URL created server-side on behalf of
-- the requesting user, never a permanently-public link.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('generated-art', 'generated-art', false)
on conflict (id) do nothing;

-- Objects are stored as `{user_id}/{case_seed}/{descriptor_hash}.{ext}` —
-- the leading path segment is what these policies check, via Supabase's
-- standard `storage.foldername(name)` per-user-folder pattern. A guessed
-- or otherwise predictable path for another user's asset is still
-- rejected here, not merely hidden by obscurity.
drop policy if exists "generated_art_select_own" on storage.objects;
create policy "generated_art_select_own" on storage.objects
  for select using (
    bucket_id = 'generated-art'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "generated_art_insert_own" on storage.objects;
create policy "generated_art_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'generated-art'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "generated_art_update_own" on storage.objects;
create policy "generated_art_update_own" on storage.objects
  for update using (
    bucket_id = 'generated-art'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
