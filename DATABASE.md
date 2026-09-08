# Database (Phase 9)

Real persistence, implemented. This document is now the setup guide, not a
plan.

## Stack

**Supabase** (Postgres + Auth), accessed through `@supabase/ssr` /
`@supabase/supabase-js`. No ORM, no service-role client anywhere — every
query in the app runs as the signed-in user, through Postgres Row Level
Security. See `lib/supabase/` and `lib/game-session/persistence/`.

## What's stored, and — more importantly — what isn't

`CaseTruth` (the culprit, hidden roles, secret timeline, undiscovered
evidence — everything `CASE_GENERATION.md` and `ARCHITECTURE.md` call
ground truth) is **never written to Postgres**. There is no column for it
anywhere in `supabase/migrations/0001_init.sql`. Every case is regenerated
server-side from `session.seed` + `difficulty` on every request — exactly
as it worked before Phase 9, when the seed lived in an in-memory `Map`
instead of a database row. Moving to Postgres changed *where* the seed is
kept, not the rule that the truth itself is never persisted.

Three tables, all RLS-scoped to `auth.uid()`:

- **`profiles`** — one row per player: `rank`, `xp`, `cases_solved`,
  `cases_failed`, `accusations_total`, and the three settings that are
  genuinely server-persisted (`sound_muted` is *not* one of them — see
  below). Auto-created on sign-up by the `on_auth_user_created` trigger.
- **`investigation_sessions`** — the player's one active, resumable case.
  A 1:1 table keyed by `user_id` (a player has at most one active
  investigation at a time, same as the pre-Phase-9 single-cookie-session
  model). Every jsonb column mirrors a `GameSession` field 1:1 —
  `evidence_status`, `lab_queue`, `notes`, `player_timeline`,
  `interrogated`, `mandates`, `board`, `accusation`,
  `crime_scene_inspected_zone_ids` — all player-produced play state, never
  anything derived from the hidden truth beyond what discovery already
  revealed to that player.
- **`case_history`** — completed cases: `seed`, `difficulty`, the
  `accusation` the player submitted, and the `score` `scoreAccusation()`
  computed from it (grade, percent, which fields were right/wrong,
  channel counts). Read by `/dossiers` and `/dossiers/[id]`, which
  regenerate `truth` from the stored seed to render the archived report —
  same non-storage rule as the active session.

## Local/dev fallback

If `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
aren't both set, `lib/supabase/config.ts#isSupabaseConfigured()` returns false and
`lib/game-session/persistence/index.ts#getStore()` hands out
`MemoryStore` instead of `SupabaseSessionStore` — the same interface,
backed by an in-memory `Map` keyed by an anonymous id cookie
(`proxy.ts` assigns it; no login required). This is exactly the pre-Phase-9
behavior, kept on purpose: nothing survives a server restart in this mode,
there is no account, and that's fine for local development without a
Supabase project. Setting only one of the two env vars is treated as a
misconfiguration (a console warning fires, and it falls back to
`MemoryStore` rather than half-connecting).

## What you need to provide to turn persistence on

1. Create a Supabase project (free tier is enough).
2. Run `supabase/migrations/0001_init.sql` against it — either via
   `supabase db push` (Supabase CLI) or by pasting it into the SQL Editor
   in the Supabase dashboard.
3. In the dashboard: **Authentication → Providers**, confirm Email is
   enabled (it is by default). Decide whether to require email
   confirmation (Authentication → Settings) — the sign-up form already
   handles both cases (`AuthForm.tsx` shows a "check your email" message
   when `signUp` doesn't return a session).
4. Copy two values from **Project Settings → API**:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **Publishable key** (Supabase's current name for the public client
     key, replacing the legacy "anon" key naming — functionally the same
     role: safe to expose client-side, scoped entirely by RLS) →
     `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
5. Put both in `.env.local` (see `.env.example`) and restart the dev
   server (or redeploy). No other env var is required — there is no
   service-role/secret key anywhere in this codebase by design, and none
   should ever be added here.

Once both variables are set, the login screen (`/login`) activates
automatically, `startNewCase` requires a signed-in user, and every table
above starts filling in for real.

## Known limitation carried over from before Phase 9

`case_history` and `investigation_sessions` scale fine for a single
player's normal use, but there's no pagination on `/dossiers` yet — it
loads a player's entire case history in one query. Not a concern at
realistic scale (hundreds of cases, not millions), worth revisiting only
if that changes.

## Settings that stay client-only on purpose

`sound_muted` exists as a `profiles` column but the app doesn't write to
it — the Web Audio mute check (`sound-manager.ts#isSoundMuted`) has to run
synchronously on the client with no round trip, so it stays a
`localStorage` preference per device. `reduce_motion` and
`hints_disabled` **are** genuinely server-persisted (see
`profile-actions.ts#updateSettingsAction`) and applied server-side on the
root `<html>` element (`app/layout.tsx`), so there's no hydration flash.
