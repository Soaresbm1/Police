# Security

## S2 — game-state write authority

### Status

Designed on branch `security/s2-game-state-integrity`. **EXPAND-1**
(`supabase/migrations/0007_s2_expand_authoritative_mutations.sql`) has been
applied to the shared Supabase project — additively only, nothing existing
was revoked (verified: policy counts and grants on all four tables unchanged
before/after). **CONTRACT** (`0008_s2_contract_client_writes.sql`) remains a
draft, not applied — current Production `ae2a2b0` still writes game state
directly, exactly as before; EXPAND-1 only adds a trusted path alongside it.
APP-1 (routing the application through that trusted path) is not deployed
yet.

Two bugs were found and fixed while applying EXPAND-1, both caught before
any legitimate call could be affected:

1. PostgreSQL grants `EXECUTE` on a new function to the implicit `PUBLIC`
   role by default; `caseline_advance_time` and
   `caseline_update_profile_preferences` initially inherited it, making
   them callable (harmlessly — each fails closed on `auth.uid() is null`)
   by `anon` too. Fixed with an explicit `revoke ... from public, anon`
   before granting to `authenticated`.
2. The capability verifier's domain-separation label concatenated a literal
   NUL byte into a `text` value (`label || chr(0) || token`) — PostgreSQL's
   `text` type cannot contain a NUL byte at all ("null character not
   permitted"), so this failed for *every* call, not just invalid ones.
   Fixed by building the digest input as `bytea`
   (`convert_to(label, 'UTF8') || '\x00'::bytea || convert_to(token,
   'UTF8')`), which has no such restriction and produces byte-for-byte the
   same input the Node.js-side verifier-installation command hashes. Also
   corrected the function's `search_path` to include `extensions`, where
   Supabase installs `pgcrypto` by convention (not `public`).

Verified live on the shared database after both fixes: a direct RPC call to
`caseline_finalize_case` with a forged token, forged score, 500 XP and
`culprit_correct: true` is rejected (`caseline: invalid server capability
token`) with the session, profile and `case_history` count all unchanged.

**APP-1** (routing `advanceTimeAction`, `updateSettings`, and
`submitAccusationAction`/finalization through the EXPAND-1 trusted RPCs) is
implemented on this branch and validated live on Preview
(`security/s2-game-state-integrity`, commit `497c2f2`). One bug was found
and fixed while writing its acceptance tests:

3. `advanceTimeAction` called the authoritative `caseline_advance_time` RPC
   *and then* `discovery.advanceTime(session, delta)` locally, which
   increments `session.currentTime` a second time for its lab-queue/event
   side effects. `withSession`'s trailing `saveSession` then persisted that
   doubled, non-authoritative local value straight back over what the RPC
   had just written — silently discarding the RPC's actual return value.
   Harmless *today* only because `saveSession` still has an unrestricted
   `UPDATE` grant on `investigation_sessions` (CONTRACT not applied); once
   CONTRACT revokes that grant down to `notes`/`board`/`player_timeline`
   only, this same code path would either desync the clock (if `saveSession`
   partially failed) or need a redesign. Fixed: `advanceTimeAction` now
   applies the RPC's returned time directly
   (`session.currentTime = await getStore().advanceTime(...)`) and calls
   `discovery.advanceTime(session, 0)` only for its completion/event side
   effects, never adding minutes a second time. Covered by
   `lib/game-session/__tests__/app1-security.test.ts`.

APP-1 test coverage (`app1-security.test.ts`, 20 tests): session_uuid
assigned fresh per new case / stable across ordinary saves / distinct per
new case; all three allowed time deltas advance the clock exactly once,
every disallowed value is a no-op that never calls the store's authoritative
`advanceTime`; `updateSettings` proven immune to extra fields (`xp`, `rank`)
smuggled into the same patch object; a forged `score`/`xpGained` in the
accusation form is inert (server always recomputes from `CaseTruth`); a
genuine submit archives exactly one `case_history` row and grants XP exactly
once; a retried submit against the same session is idempotent (snapshotting
primitives before re-reading — `MemoryStore` hands back the same object
reference on every call, so comparing an object to itself would have hidden
a real double-write).

### Incident: `CASELINE_S2_SERVER_CAPABILITY` Preview/Production divergence

First Preview deployment of APP-1 (`police-8b7ho3r98-soares-2.vercel.app`)
failed every accusation submission with `caseline: invalid server capability
token` (500, Vercel runtime log). Root cause: Vercel held **two separate**
entries for `CASELINE_S2_SERVER_CAPABILITY` — one scoped to Production, one
to Preview — with different values, unlike `CASELINE_S1_MASTER_SECRET`
(single "Production and Preview" entry). The original token value was lost
(never recorded outside Vercel), so recovery wasn't possible.

Verified before any fix: `caseline_check_server_capability` raises its
exception *before* the atomic `UPDATE ... WHERE accusation IS NULL` claim
runs (confirmed live: `investigation_sessions.accusation IS NULL` stayed
true, `case_history` count and `profiles.xp` stayed unchanged after the
failed call). A wrong capability token can never corrupt state — it can
only ever block a legitimate write, which is the correct fail-closed
behavior.

Since the S2 capability is an authorization check, not an encryption key
(unlike S1's master secret), rotation requires no re-encryption of existing
data — only replacing the live value and its stored verifier:

1. New 256-bit value generated locally (`crypto.randomBytes(32)`, base64url).
2. Both Vercel entries replaced with a single "Production and Preview"
   entry holding the identical new value (matching S1's pattern, closing the
   divergence risk for good).
3. Verifier recomputed locally with the same domain-separated SHA-256
   formula the database uses; only the resulting hex hash (never the token)
   was shared to install it.
4. `s2_server_capabilities.secret_hash` updated in place for
   `name = 'trusted_mutation_v1'` — one `UPDATE`, no migration, no other
   table touched, `CASELINE_S1_MASTER_SECRET` untouched.
5. Preview redeployed (`Redeploy`, same commit `497c2f2`, no rebuild of
   source) so the new env var value is picked up — Vercel bakes env vars in
   at deploy time, not read live per request.
6. Verified on the redeployed Preview
   (`police-q6j8nqwv5-soares-2.vercel.app`):
   - A direct REST call to `caseline_finalize_case` using the test account's
     own JWT + the public publishable key + a forged token, 500 XP, grade S,
     `culprit_correct: true` was rejected (`400`,
     `caseline: invalid server capability token`); state unchanged after
     (verified in SQL).
   - A genuine accusation submitted through the real UI succeeded (no more
     500): `case_history` count 6→7, `profiles.xp` 80→120, rank
     Recrue→Agent, all internally consistent with the grade awarded.

### Threat model

Attacker has: their own CASELINE account, their own valid JWT, the public
Supabase publishable key, the full public source code, and can send arbitrary
PostgREST/RPC requests. Attacker does not have: the service-role key, the S1
master secret, or another user's credentials.

### Known S2 exposure (current, pre-CONTRACT)

Every table's RLS policy grants `authenticated` broad row-level CRUD keyed
only on `auth.uid() = user_id`, with no column or semantic restriction —
because no service-role client exists in this codebase, server code writes
through the exact same privilege level a direct REST caller has. Confirmed on
the dedicated test account (`testclaude@gmail.com`), then reverted:

- `investigation_sessions`: `current_time_minutes` set to an arbitrary value; `seed` overwritten with plaintext, bypassing S1 at the write layer entirely (S1 protects confidentiality of legitimately-written data, not write integrity).
- `profiles`: `xp`/`rank` set directly.
- `case_history`: a forged row inserted (UPDATE/DELETE were already blocked — no grant exists for either).
- `anon` role: denied everywhere (401).

Also found, independent of RLS: `submitAccusationAction`/`completeCase` are
not idempotent — a double-submit (double-click, two tabs, retry) can insert
two `case_history` rows and race the profile XP update (lost-update pattern,
no transaction). `advanceTimeAction`/`discovery.advanceTime` accept an
unclamped `minutes` value with no server-side range check.

### Capability model — why SECURITY DEFINER alone isn't enough

A SECURITY DEFINER function can prove *whose* row is being touched
(`auth.uid()`) and enforce that a write only affects that row. It cannot prove
that a caller-supplied score/grade/XP value is the *genuine* result of scoring
an accusation against `CaseTruth` — that computation only exists in the
Next.js process (`scoreAccusation`, regenerated from the seed) and is never
present in Postgres. Ownership alone is therefore not sufficient authorization
for functions that persist an authoritative *result* rather than a player's
*choice*.

Design: a narrow **server capability token** (`CASELINE_S2_SERVER_CAPABILITY`,
server-only Vercel env var, never sent to the browser) that trusted server
code passes as an explicit argument to `caseline_finalize_case` only. The
database stores nothing but a SHA-256 hash of it, in a table with RLS enabled
and zero policies (default-deny for every role). A leaked token lets someone
call `caseline_finalize_case` with a self-chosen score for **their own
account only** — `auth.uid()` inside the function still gates which row is
touched, so this never grants cross-user access; its blast radius is a single
function's semantics, not RLS-wide bypass the way a leaked service-role key
would be.

Functions that only need ownership (time advance, profile preferences) do not
require this token and are granted directly to `authenticated`.

### Idempotent finalization

`investigation_sessions.session_uuid` (new) identifies one investigation
instance across the lifetime of the 1-row-per-user table.
`case_history.source_session_uuid` (new, nullable) links a history row back to
it, with a partial unique index (`WHERE source_session_uuid IS NOT NULL`) —
safe against existing data because every current row is NULL there. Inside
`caseline_finalize_case`, a single conditional `UPDATE ... WHERE accusation IS
NULL` is the atomicity primitive: Postgres's row lock on that UPDATE makes
"exactly one caller wins" hold under concurrency without an explicit
`SELECT ... FOR UPDATE`. A losing/retried call returns the existing result
rather than erroring or duplicating the reward.

### Rollout (expand → contract)

EXPAND is additive only — adds functions/columns/grants, revokes nothing.
Production `ae2a2b0` keeps working through it unmodified. Only once an S2
application is confirmed to be the sole writer of this shared database does
CONTRACT revoke the broad `UPDATE`/`INSERT` grants and replace them with
column-level grants for genuinely player-owned content (`notes`, `board`,
`player_timeline`; profile preferences via function only). See the two
migration files' own comments for the exact SQL and reasoning.

### EXPAND-2 (design + local draft SQL — NOT applied)

Completes the trusted-mutation architecture for every remaining
authoritative column: evidence/discovery, mandates/warrants, lab
queue/results, surveillance, investigation_events, hint-state/penalties, and
Generated Art metadata. Draft migration:
`supabase/migrations/0009_s2_expand2_trusted_mutations.sql` — additive only,
same discipline as EXPAND-1 (verified by
`lib/security/__tests__/s2-migration-structure.test.ts`: never revokes an
existing grant, no dropped policies, every capability-required function
checks the token before its first write, every function sets an explicit
`search_path`).

**Audit finding, all three subsystems (evidence, mandates/lab/surveillance,
events/Generated Art):** every authoritative field found during S1/EXPAND-1
still rides the same single whole-row `saveSession` upsert
(`supabase-store.ts`, `authenticated` role) that time/XP/seed used to. A
direct REST `UPDATE investigation_sessions` can today forge: arbitrary
evidence as discovered/analyzed with no elapsed lab time
(`evidence_status`/`lab_queue`), a warrant's `granted` decision
(`mandates` — the existing ESLint rule around `MandateRecord.granted` is a
lint-only protection, not a database boundary), fabricated surveillance
observations (`surveillance`), fabricated investigation-event narrative text
or a premature `scheduled→ready` transition (`investigation_events`), and a
zeroed-out hint penalty that would otherwise reduce accusation score
(`hint_state` — `computeHintPenalty` reads it at scoring time). By contrast,
`crime_scene_examined`/`crime_scene_inspected_zone_ids` carry no CaseTruth
content — forging them is harmless UI bookkeeping, so 0008 (CONTRACT) now
grants them alongside `notes`/`board`/`player_timeline` rather than routing
them through an RPC.

**RPC capability classification** (mirrors §"Capability model" above — every
function whose authoritative result needs `CaseTruth`, which no SQL function
can compute, requires the existing `CASELINE_S2_SERVER_CAPABILITY`; every
function whose validation is fully derivable from already-stored DB state
does not):

| Function | Classification | Why |
|---|---|---|
| `caseline_collect_evidence` | AUTHENTICATED-SEMANTIC | Only checks the evidence is already `"discovered"` — pure DB-state |
| `caseline_reveal_evidence` | SERVER-CAPABILITY-REQUIRED | Which ids are genuinely part of `truth.evidence` for this query |
| `caseline_submit_to_lab` | SERVER-CAPABILITY-REQUIRED | `analysisType`/`readyAt` derived from `truth.evidence` |
| `caseline_advance_time` (extended) | AUTHENTICATED-SEMANTIC | Lab completion/event-ready are pure `currentTime` comparisons, no `CaseTruth` |
| `caseline_request_mandate` | SERVER-CAPABILITY-REQUIRED | `granted`/`reason` computed by `evaluateMandate(truth, ...)` |
| `caseline_start_surveillance` | SERVER-CAPABILITY-REQUIRED | `observations` computed by `projectSurveillanceObservations(truth, ...)` |
| `caseline_record_hint` | SERVER-CAPABILITY-REQUIRED | Eligibility/text computed by `computeHintOpportunities(truth, session)` |
| `caseline_mark_event_seen` | AUTHENTICATED-SEMANTIC | Only allows `ready→seen`, no content/timing decision |
| `caseline_ga_*` (Generated Art metadata, 7 functions) | SERVER-CAPABILITY-REQUIRED | Only ever called by trusted background code; capability closes off direct-REST forgery uniformly with everything else |

No generic `caseline_update_investigation_state(jsonb)`-style patch function
exists anywhere — every function takes narrow, purpose-specific arguments
for one semantic operation (guarded by a structural test).

**Idempotency:** every function is safe to retry. `caseline_collect_evidence`
and `caseline_submit_to_lab` no-op if the evidence is already past the
relevant status; `caseline_request_mandate`/`caseline_start_surveillance`
no-op if their key already exists (a mandate/surveillance decision is made
once, at request time, by design — a repeat request must never re-decide
it); `caseline_record_hint` no-ops if the requested level is at or below
already-recorded progress; `caseline_reveal_evidence` is monotonic (never
downgrades a more-advanced status back to `"discovered"`).

**Session broad-save analysis (blocks CONTRACT until resolved):**
`SupabaseSessionStore#saveSession` still upserts every column on every call,
including the ones EXPAND-2 moves behind RPCs. This is harmless *before*
CONTRACT (the column grant is still broad), but CONTRACT's column-level
grant (`notes, board, player_timeline, crime_scene_examined,
crime_scene_inspected_zone_ids, last_action_message,
last_revealed_evidence_ids` only) would make every ordinary `saveSession`
call fail outright, since it still tries to write `evidence_status`,
`mandates`, etc. **APP-2 must narrow `saveSession`/`sessionToRow` to only
ever send the player-owned column list before CONTRACT can be applied** —
this is the concrete blocker `0008`'s header now calls out explicitly. Not
yet implemented (APP-2 code, pending this design being accepted).

**Generated Art Storage — deliberately unresolved, needs explicit user
decision before any code changes:**

A PostgreSQL `SECURITY DEFINER` function has no mechanism to elevate a
Supabase Storage REST call's privilege — Storage authorizes purely via
`storage.objects` RLS evaluated against the caller's own JWT, and object
bytes never pass through a SQL function body at all. This is a fundamentally
different execution boundary than every RPC above, which is why the pattern
that solved every table-write gap does not solve this one.

Today, `lib/art/generation/asset-store.ts#uploadAssetBytes`/`moveObject` use
the same per-request, cookie-derived `authenticated`-role client as
everything else (`lib/supabase/server.ts#createServerSupabaseClient`) — no
`service_role` key exists anywhere in this codebase (confirmed: only textual
mentions in `0007`'s own comments, discussing it as the alternative that was
rejected in favor of SECURITY DEFINER). The existing Storage policies
(`0002_generated_assets.sql`) grant any authenticated player read/insert/
update on their own `{userId}/...` prefix — broader than needed (a player
could already overwrite/move their own generated-art objects via direct
Storage REST, though never another user's), and CONTRACT's current draft
only removes the insert/update policies without proposing a trusted
replacement.

Two realistic options:
1. **A narrowly-scoped `service_role` credential, isolated to one tiny
   server-only Storage module.** `service_role` bypasses all RLS
   project-wide — its blast radius if leaked is total (every table, every
   user's data), categorically larger than the S2 capability token's
   (self-row-only). Mitigation: confine it to a single file
   (e.g. `lib/art/generation/storage-admin-client.ts`) used only for
   `upload`/`move` calls into the `generated-art` bucket, never imported by
   any gameplay-mutation code path, never used for a table read/write that
   the existing SECURITY DEFINER functions already cover.
2. A custom-claim JWT scheme (Supabase's Custom Access Token Hook) that
   marks a request as "from trusted server code" for `storage.objects`
   policies to check — investigated and rejected as **not actually
   lower-blast-radius**: minting such a claim for arbitrary requests
   requires equivalent administrative access to configure, and Supabase's
   hook applies per real authenticated user, not a distinct "server"
   identity, so it doesn't cleanly express "this Storage call has server
   authority independent of any one player's session."

**Recommendation:** option 1, if and when Storage write-locking becomes a
priority — but this requires a **new secret**
(`SUPABASE_SERVICE_ROLE_KEY`, server-only Vercel env var, never
`NEXT_PUBLIC_`), obtained from Supabase Dashboard → Project Settings → API →
`service_role` secret. Per explicit instruction, **this has not been
introduced or configured** — no code in this repository references it. If
the user wants to proceed, that is a distinct, explicit decision separate
from the rest of EXPAND-2 (which needs no new secret at all, reusing
`CASELINE_S2_SERVER_CAPABILITY` throughout). Until then, Generated Art
Storage write-locking stays out of CONTRACT's scope — `0008`'s Storage
section is left as a draft placeholder only.

## S1 — active-case seed confidentiality

### Why the seed is a secret

`generateCase(seed, { difficulty })` is a pure function: whoever knows a
case's seed can regenerate its entire `CaseTruth` (culprit, motive, hidden
timeline) offline. The source code is public, so nothing about the RNG, the
hash functions or the path formats may be relied on. Only server-side secret
key material is.

Before S1, an unresolved case's seed reached the player through:

| Channel | How |
|---|---|
| `investigation_sessions.seed` | Players can read their own row directly through Supabase REST with their session token and the public publishable key (RLS `select own`). |
| `generated_assets.case_seed`, storage folder names | Same direct access, plus listing their own `generated-art/{userId}/` folder. |
| Signed image URLs | Objects lived at `{userId}/{seed}/{hash}.{ext}`; the path is in clear text in every signed URL (and inside its token). |
| `CaseIntroOverlay` props, `sessionStorage` | The seed was a client-component prop and the `caseline:intro-shown:<seed>` key. |
| Visible entity ids | `person_…`/`loc_…`/`ev_…` ids are 32-bit `cyrb128` hashes of strings that start with `caseline::<seed>::`. Over the 31-bit legacy seed space, one visible infrastructure location id recovers the seed in minutes on one CPU core (measured ≈2×10⁶ candidates/s). |

After a case is resolved (accusation recorded / archived to `case_history`)
the seed is no longer secret — the truth has been revealed.

### Configuration

| Variable | Scope | Value |
|---|---|---|
| `CASELINE_S1_MASTER_SECRET` | server-only (never `NEXT_PUBLIC_`) | base64url of ≥32 random bytes |

Generate one locally and paste it into the deployment environment — never
into a committed file:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

**Preview and Production share one Supabase project** (verified at S1 by
comparing the public project hostname baked into both builds), so both
environments **must carry the same value**. A different value on one side
makes every session encrypted by the other unreadable there.

Fail-closed behavior when Supabase is configured but the secret is missing or
invalid: creating a case throws before anything is written, and loading an
active session throws an operational error (logged as
`[CASELINE] [S1] …: S1_CONFIG_MISSING`) — never a silent plaintext fallback,
never a misleading "no investigation". The in-memory dev store (no Supabase)
uses a random per-process key, which lives exactly as long as that store's
data.

### Key derivation

```
master  = CASELINE_S1_MASTER_SECRET (≥256 bits)
K_ref   = HKDF-SHA-256(master, salt = "", info = "caseline/s1/case-ref/v1",        32 bytes)
K_seed  = HKDF-SHA-256(master, salt = "", info = "caseline/s1/seed-encryption/v1", 32 bytes)
```

The raw master is never used directly and no key serves two purposes.
Rotating the master invalidates every stored envelope and every caseRef-keyed
asset path, so rotation needs a dedicated re-encryption step (not built).

### Case reference (`caseRef`)

```
caseRef = "cr1_" + hex( HMAC-SHA-256(K_ref, "caseline/s1/case-ref/v1\0" + seed)[0..16] )
```

- Deterministic per logical seed; versioned by its prefix; `[a-z0-9_]` only.
- 128-bit truncation: predicting or forging one without `K_ref` is a 2¹²⁸
  guess; collisions only become likely around 2⁶⁴ cases (≈1.5×10⁻²¹ for a
  billion cases).
- Safe to expose: it is the only case identifier a browser may see (image
  paths, the intro's `sessionStorage` key).
- Never a seed: `generateCase` rejects the `cr<n>_` and `s1e.` prefixes.

### Seed at rest (`investigation_sessions.seed`)

```
s1e.v1.<nonce>.<ciphertext>.<tag>     (base64url parts)
AES-256-GCM(K_seed, nonce = 96 random bits, tag = 128 bits,
            AAD = "caseline/s1/session-seed/v1\0investigation_sessions\0" + user_id)
```

Decryption happens only in `SupabaseSessionStore.getActiveSession`; the
logical `session.seed` stays the plaintext `CASE-…` value, server-side. An
envelope moved onto another user's row fails authentication; malformed
envelopes, unknown versions and non-seed plaintexts all throw. A save reuses
the envelope already stored for that seed rather than re-encrypting.

`case_history.seed` stays plaintext: archived cases are resolved.

### Strong seeds

New cases use `CASE-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX`: 25 characters drawn from
`crypto.getRandomValues` with rejection sampling (bytes ≥ 252 discarded), so
each character is exactly uniform over 36 symbols —
25 × log₂36 ≈ **129.25 bits**. Legacy `CASE-XXXXXX` seeds (≈31.02 bits) stay
valid forever and regenerate byte-identically; only new cases use the long
format.

### Case numbers

Legacy cases keep `formatCaseNumber(seed)`. Strong-format cases display
`formatCaseNumber(caseRef)`, so the ~13 bits shown on screen are derived
from a keyed value and reveal nothing about the seed.

### Lazy migration of pre-S1 active cases

On the first authenticated server-side load of a session whose row still
holds a plaintext legacy seed:

1. `UPDATE investigation_sessions SET seed = <envelope> WHERE user_id = … AND
   seed = <plaintext>` — seed column only (no `updated_at` bump, no other
   state), compare-and-swap so concurrent loads are safe and it is
   idempotent. On failure the load still succeeds and the next load/save
   retries (every save seals).
2. Generated Art of that case: every object under `{userId}/{seed}/` is
   Storage-`move`d to `{userId}/{caseRef}/` (existing own-folder
   `select`/`update` policies — no RLS change, nothing deleted), every row of
   that user referencing the old path is repointed, and the case's rows are
   relabeled `case_seed = caseRef`. A failed move leaves that asset on its
   legacy key (still displayed) and is retried on a later load.

Lookups accept both `caseRef` and the legacy seed, so no existing image
disappears. New rows/objects can only be written with a `caseRef`
(`asset-store.ts` refuses anything else). The column keeps its historical
`case_seed` name to avoid a schema migration; it now holds a case key.

### Residual risks

- **Legacy seeds stay brute-forceable from visible ids.** Their entity ids
  are part of historical `CaseTruth` and cannot change without changing the
  case. Accepted limitation for cases generated before S1.
- **Strong seeds and non-cryptographic RNG.** Exhaustive search over 2¹²⁹
  seeds is infeasible (≈10²⁵ years at the measured 2×10⁶ guesses/s; ≈10¹⁹
  years at 10¹² guesses/s). But every visible id is a `cyrb128`
  continuation of the same 128-bit internal state reached after absorbing
  `caseline::<seed>::`, and neither `cyrb128` nor `sfc32` is a cryptographic
  primitive — resistance to algebraic/SAT state recovery from several
  visible 32-bit ids is unproven. Removing that dependency means keying id
  derivation or the root RNG for new-format seeds with a PRF, which changes
  generation for new cases — deliberately out of S1's scope.
- **Reused art from older cases.** Generated Art V2B reuse points a new
  case's row at another case's existing object. When that source is a
  pre-S1 archived (or abandoned) case whose objects were never migrated, the
  new case's signed URL contains that *older* case's legacy seed (observed on
  Preview). It never contains the active case's seed; an archived case's
  truth is already revealed, and an abandoned case cannot be resumed.
  Migrating archived folders or excluding legacy-path reuse sources would
  remove it; deliberately not done in S1.
- **Operational coupling.** Preview writes to the production database: a
  session opened by S1 code (Preview included) is encrypted/migrated, and
  pre-S1 code reading it would regenerate the wrong case. Use a dedicated
  test account on Preview, and never roll Production back below S1 without a
  decrypting forward fix.

### S2 — deferred (game-state integrity)

Found during S1, intentionally not changed: with their own token a player can
directly `UPDATE` their `investigation_sessions` row (evidence status,
accusation, time, and the seed column itself), `UPDATE` their `profiles`
(XP, rank, counters), and `INSERT` arbitrary `case_history` rows. These are
cheating/integrity issues, not spoiler leaks.
