# Database

**Not implemented yet.** This document describes the intended shape for the
persistence phases (Phase 9 in `ROADMAP.md`); nothing in this repository
currently reads or writes a database.

## Planned stack

- **Supabase** (Postgres + Auth) as the backend, per the project's chosen
  stack. Prisma or the Supabase JS client for access — whichever proves
  simpler once auth/save is actually built; not yet decided since no schema
  exists yet.

## Planned separation

`CaseTruth` (the full hidden state) is expensive to regenerate but must
never be exposed to the client outside the Case Lab. The intended persistence
split:

- `cases` — `{ id, seed, difficulty, generated_at }` plus the serialized
  `CaseTruth` in a server-only column/table, never selected by any
  client-reachable query.
- `case_progress` — per-player, per-case: discovered evidence ids, player's
  own timeline hypotheses (confirmed/probable/hypothesis/contested), notes,
  evidence-board node/edge positions, interrogation transcripts, elapsed game
  time, mandates requested/granted.
- `careers` — player id, grade, XP, cases completed, resolution rate.

## Why this doesn't exist yet

Per the project's own build order (`ROADMAP.md` Phase 9 comes after
gameplay), persistence was deliberately deferred: the engine (Phases 1–5) is
the part that's hard to get right and the part everything else depends on.
Building save/load against a gameplay UI that doesn't exist yet would mean
designing the schema twice.
