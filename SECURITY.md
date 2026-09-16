# Security

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
