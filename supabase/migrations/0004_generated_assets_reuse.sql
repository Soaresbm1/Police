-- CASELINE — same-user reusable generated-art pool (Generated Art V2B)
--
-- Additive only. Does NOT touch the existing `descriptor_hash` column or
-- its unique constraint (user_id, descriptor_hash, generation_version,
-- provider) — that remains the exact-entity cache, unchanged, and always
-- takes priority over reuse (see lib/art/generation/pipeline.ts).
--
-- `reuse_key` is a SEPARATE hash of a deliberately coarser, guilt-safe
-- visual descriptor (see lib/art/generation/reusable-descriptor.ts) —
-- never derived from personId/locationId/culpritId/roles/motive/evidence/
-- discovery state/case_seed. Nullable: every row created before this
-- migration simply has reuse_key = NULL, which never matches any lookup
-- (NULL never equals anything in SQL) — those rows are neither reuse
-- sources nor reuse consumers, forever, with no backfill needed (see the
-- V2B report for why a backfill was deliberately not built).
--
-- `reuse_count` tracks how many times a CANONICAL row's storage object has
-- been pointed to by another entity's row, for cosmetic "prefer the
-- least-reused compatible asset" ordering (see findReusableAssetCandidates)
-- — never used for anything gameplay-affecting.
--
-- `source_asset_id` is the canonical-source pointer that makes reuse chains
-- structurally impossible:
--   - a freshly-generated row (a real Cloudflare call) always has
--     source_asset_id = NULL — it IS a canonical source.
--   - a reused row always has source_asset_id pointing DIRECTLY at the
--     canonical row it copied its storage_path from — never at another
--     reused row. There is no A -> B -> C chain: every reused row's
--     source_asset_id is exactly one hop from a row with source_asset_id
--     IS NULL, by construction (see pipeline.ts's canonicalization —
--     resolves `candidate.sourceAssetId ?? candidate.id` before ever
--     writing a new row, so even a hypothetical non-canonical candidate
--     leaking through the query filter below cannot create a chain link).
--   - `findReusableAssetCandidates` only ever selects rows with
--     source_asset_id IS NULL — a reused row can never itself become a
--     future reuse source, so reuse_count/least-reused-ordering/visual
--     diversity selection always compare true, independent canonical
--     sources.
--   - the self-referencing foreign key uses Postgres's default ON DELETE
--     behavior (NO ACTION) — deliberately NOT SET NULL or CASCADE. No
--     deletion code exists yet for generated_assets (see
--     lib/art/generation/__tests__/storage-lifecycle.test.ts), but this
--     constraint already enforces, at the database level, the future
--     invariant this table must respect once one is written: a canonical
--     row can never be deleted while any other row's source_asset_id still
--     points at it — the FK violation stops it outright, rather than
--     silently orphaning a reused row's storage_path or promoting it to
--     look canonical.
--
-- Idempotent, matching 0001_init.sql / 0003_investigation_events.sql's
-- style: `add column if not exists`.

alter table public.generated_assets
  add column if not exists reuse_key text,
  add column if not exists reuse_count integer not null default 0,
  add column if not exists source_asset_id uuid references public.generated_assets (id);

-- Partial index: only `ready`, CANONICAL rows (source_asset_id IS NULL) are
-- ever valid reuse sources — matches findReusableAssetCandidates' query
-- shape exactly (equality on 5 columns + source_asset_id IS NULL, ordered
-- by reuse_count/created_at once matched). A reused row is never covered
-- by this index and therefore never returned by that query.
create index if not exists generated_assets_reuse_key_idx
  on public.generated_assets (user_id, asset_kind, generation_version, provider, reuse_key)
  where status = 'ready' and source_asset_id is null;

-- Lets a future cleanup path efficiently find every row referencing one
-- canonical source (the reference-counting check the storage-lifecycle
-- invariant above depends on) without a full table scan.
create index if not exists generated_assets_source_asset_id_idx
  on public.generated_assets (source_asset_id);

-- ---------------------------------------------------------------------
-- Atomic reuse-count increment.
--
-- A plain "read count, add 1, write count" from application code would
-- lose updates under concurrent reuse (Generated Art V2A's bounded
-- portrait concurrency, or two cases being created around the same time)
-- — several concurrent readers could read the same stale count and all
-- write back the same incremented value. A single UPDATE statement is
-- atomic at the row level regardless of how many callers issue it
-- concurrently, which is all that's needed here. Always called with the
-- CANONICAL source's id (see pipeline.ts) — never a reused row's id.
--
-- `security invoker` (NOT definer) deliberately: this runs with the
-- calling user's own privileges, so the existing
-- "generated_assets_update_own" RLS policy (auth.uid() = user_id) still
-- applies exactly as if this were a plain UPDATE from client code — no
-- privilege escalation, no service-role-shaped trust introduced. The
-- explicit `owner_id` parameter is defense in depth on top of that RLS
-- check, matching this codebase's existing house style (every function in
-- asset-store.ts already filters by user_id explicitly in addition to
-- relying on RLS).
-- ---------------------------------------------------------------------
create or replace function public.increment_reuse_count(asset_id uuid, owner_id uuid)
returns void
language sql
security invoker
as $$
  update public.generated_assets
  set reuse_count = reuse_count + 1, updated_at = now()
  where id = asset_id and user_id = owner_id;
$$;

grant execute on function public.increment_reuse_count(uuid, uuid) to authenticated;
