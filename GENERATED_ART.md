# Generated Art Pipeline

Infrastructure for **optional**, permanent AI-generated case artwork on top
of the procedural renderers built in the Art & Visual Production milestone.
Procedural art (`lib/art/*.ts`, `lib/game-engine/portraits/portrait-service.ts`)
remains the permanent fallback and, as of this milestone, the only thing
actually shown to players — no real image-generation provider is wired in
yet (see "Status" below).

## Target flow

```
CaseSeed
  → CaseVisualManifest / individual descriptor (buildCharacterVisualDescriptor, etc.)
  → prompt builder (character-prompt.ts / crime-scene-prompt.ts)
  → descriptorHash (lib/art/asset-cache.ts#hashDescriptor)
  → cache lookup (generated_assets table, keyed on user+descriptorHash+generationVersion+provider)
  → generated asset if missing (GeneratedAssetProvider.generate(), never NextJS render-time)
  → Supabase Storage (private "generated-art" bucket)
  → database metadata (generated_assets row, status: ready)
  → signed URL, reused everywhere that descriptor's asset is needed
```

`lib/art/generation/pipeline.ts#getOrGenerateAsset()` implements this end to
end. It is dependency-injected (`{ store, provider }`) so the orchestration
logic (dedup, cooldown, cost cap, state transitions) is unit-tested without
a live Supabase instance — see `lib/art/generation/__tests__/`.

## Status: Cloudflare Workers AI pilot — one real portrait generated and verified

`lib/art/generation/providers/cloudflare-provider.ts` implements
`GeneratedAssetProvider` against Cloudflare Workers AI's
`@cf/black-forest-labs/flux-1-schnell` (called via the plain REST API —
this is a Next.js app, not a Worker, so there's no `env.AI` binding).
`lib/art/generation/active-provider.ts` picks it automatically once
`CLOUDFLARE_ACCOUNT_ID`/`CLOUDFLARE_API_TOKEN` are both set in the
environment; with either missing, `activeGeneratedAssetProvider` resolves
to the null provider and CASELINE stays 100% procedural, no crash.

**First real pilot generation completed successfully** via `/case-lab/art`
— one character portrait, persisted to Supabase Storage, confirmed reused
across a page refresh and a full dev-server restart with zero additional
Cloudflare calls. Two real bugs were found and fixed during this pilot
(both now covered by regression tests or structurally prevented):

1. **The live API rejects a `seed` request field** — several documented
   examples (including Cloudflare's own docs site) show one, but the real
   endpoint returned `HTTP 400` / error code 5006 (*"Additional or
   unevaluated properties '/seed' at '/' not allowed"*). Removed from the
   request body; CASELINE's own descriptor-hash cache is what actually
   provides reuse/determinism, so nothing about the "generate once"
   guarantee depended on Cloudflare-side seeding.
2. **`hashDescriptor()` returned raw JSON, not an actual hash** — it
   serialized the descriptor deterministically but never hashed it, so a
   `descriptor_hash` value like `{"approxAge":"young",...}` was used
   directly as a Supabase Storage object-key path segment, which Storage
   rejects (`Invalid key`). Fixed to a proper SHA-256 hex digest
   (`lib/art/asset-cache.ts`) — short, stable, and storage-path-safe. This
   also fixed a related gap: `pipeline.ts`'s outer error handler didn't
   log the failure or mark the record `failed` when something threw
   *after* a successful provider call, leaving the row stuck at
   `generating` forever; both are now fixed (logged, and marked `failed`
   so the normal retry/cooldown rules apply to it like any other
   failure). A dev-only "Débloquer" (unstick) action was added to
   `/case-lab/art` to recover any future row stuck at `queued`/`generating`
   without needing direct database access.

**No screen calls the pipeline automatically yet.** The only live call
site is a manual, dev-only trigger: `/case-lab/art` (never reachable in
production — same `NODE_ENV` gate as `/case-lab`) lists the pilot-scope
assets for one case (victim + suspects + witnesses + crime scene) and lets
a developer generate ONE selected asset at a time via
`app/case-lab/art/actions.ts#triggerAssetGenerationAction`. Nothing in
CASELINE can call Cloudflare without that specific button being clicked.

### Steps configuration

`IMAGE_GENERATION_STEPS` (optional env var) controls FLUX.1 [schnell]'s
diffusion step count, clamped to the model's documented 1-8 range,
defaulting to Cloudflare's own default of 4.

### Response-format defensiveness

Cloudflare's documented examples for this model are inconsistent about
whether the REST endpoint returns a JSON envelope (`{"result":{"image":
"<base64>"}, "success":true}`, matching every other Workers AI REST
response) or raw image bytes directly. The provider handles both, keyed
off the response's `content-type` header. **Confirmed by the real pilot
request**: this account/model combination returns the JSON-wrapped form
(`content-type: application/json`, `result.image` as base64) — the raw-
binary branch is exercised only by tests, not (so far) by the real API.

## Schema

`supabase/migrations/0002_generated_assets.sql` adds:
- `public.generated_assets` — one row per (user, descriptor, generation
  version, provider). Never stores anything from `CaseTruth` (no culprit
  id, roles, motive, staging) — only `case_seed` + `descriptor_hash`, both
  already safe to store elsewhere in this schema (`case_seed` is exactly
  what `investigation_sessions`/`case_history` already persist).
- A private Storage bucket, `generated-art` — the project's first. Objects
  live at `{user_id}/{case_seed}/{descriptor_hash}.{ext}`; `storage.objects`
  RLS policies check that the leading path segment equals `auth.uid()`, so
  a guessed/predictable path for another user's asset is rejected at the
  Postgres/Storage layer, not merely hidden.

Both RLS-protected the same way as every other table in this project:
`auth.uid() = user_id`. **No service-role client was introduced** — every
read/write in `lib/art/generation/asset-store.ts` runs through the existing
request-scoped, RLS-respecting `createServerSupabaseClient()`, exactly like
`case_history`/`investigation_sessions`. This is a hard architectural
constraint of this codebase (see ARCHITECTURE.md/DATABASE.md), not a choice
made for this milestone alone.

**To apply**: run `0002_generated_assets.sql` the same way `0001_init.sql`
was applied (Supabase SQL Editor or CLI migration). It creates the bucket
itself (`insert into storage.buckets ...`) — no separate dashboard step.

## Provider contract

```ts
// lib/art/generated-asset-provider.ts
interface GeneratedAssetResult { bytes: Uint8Array; contentType: string; width: number; height: number; model: string }
interface GeneratedAssetProvider {
  generate(kind: "character_portrait" | "crime_scene_environment", prompt: string, seed: string): Promise<GeneratedAssetResult | null>;
}
```

Providers receive a finished prompt string (built by our own versioned,
tested prompt builders — `character-prompt.ts`, `crime-scene-prompt.ts`),
never the raw visual descriptor. A provider implementation is a thin
adapter: call the vendor API, return bytes or `null`. No gameplay code
needs to change to swap providers.

## Cost controls (`lib/art/generation/limits.ts`)

- `MAX_ASSETS_PER_CASE = 10` — pilot scope: victim + primary suspect
  portraits + important witness portraits + one crime-scene environment.
- `MAX_GENERATION_ATTEMPTS = 3`, `FAILURE_COOLDOWN_MINUTES = 30` — a
  failing (descriptor, version, provider) stops retrying automatically
  after 3 attempts, and waits at least 30 minutes between attempts.
- `GENERATION_TIMEOUT_MS = 20_000` — gameplay never waits indefinitely;
  the pipeline gives up and reports `failed` so the caller falls back to
  procedural art immediately.
- Tests only ever use `MockGeneratedAssetProvider`/`NullGeneratedAssetProvider`
  — nothing in `npm run test`/`build` can call a paid API.

## Evidence/CCTV scope (documented, not built this pass)

Per `lib/art/evidence-kind.ts`'s existing grouping:

| Good generation candidates | Must stay deterministic (exact info matters) |
|---|---|
| `weapon` (generic object photo) | `forensic_physical` (fingerprint/DNA results) |
| generic physical/context photos | `digital_communication`/`digital_technical` (exact text) |
| | `financial` (exact amounts) |
| | `witness_statement` (exact text) |
| | `geolocation` (map/tower — already deterministic) |
| | `camera_footage`/CCTV (privacy/visibility rules — see below) |

CCTV: if generated imagery is ever used, it must be a generated **base**
frame with the existing deterministic `CCTVFrameDescriptor` treatment/overlay
(timestamp burn-in, visibility-gated silhouette detail) layered on top —
never raw generated output shown as-is. Low-quality evidence must stay
low-quality; generated art can never reveal more than the descriptor's
`identifiable` flag already permits.

## Security checklist

- [x] Provider secret would be server-only (`IMAGE_GENERATION_API_KEY`,
      never `NEXT_PUBLIC_*`) — not set anywhere yet.
- [x] Storage RLS: `storage.objects` policies scoped to `auth.uid()` folder.
- [x] `generated_assets` RLS: `auth.uid() = user_id` on select/insert/update.
- [x] No `CaseTruth` field in the schema or in any prompt builder's input type.
- [x] Signed URLs only (bucket is private) — no permanently-public asset links.
- [x] No service-role client added.

## Estimated generations per new case (pilot cap)

Typically 5–10: 1 victim portrait + 3–5 primary suspects + 1–3 important
witnesses + 1 crime-scene environment, capped hard at `MAX_ASSETS_PER_CASE`.

## Crime-scene environments — hybrid system (pilot, no real generation yet)

Status as of this pass: implementation + tests complete, gates green,
**zero real Cloudflare calls made for crime scenes so far** — awaiting
approval for the first real generation (see the chat summary/report
delivered alongside this change).

Architecture, matching the character-portrait pattern exactly:

```
CrimeSceneVisualDescriptor (locationId, seed, layoutTemplate, timeOfDay,
                             architectureStyle, weather)
  → buildCrimeSceneEnvironmentPrompt() (crime-scene-prompt.ts, v2)
  → hashDescriptor() → generated_assets cache lookup
  → getOrGenerateAsset() (same pipeline.ts, same Cloudflare provider)
  → Supabase Storage / signed URL (lib/art/generation/scene-lookup.ts)
  → full-screen scene background in CrimeSceneScreen.tsx
     (procedural SVG first, generated photo cross-fades in if ready)

  — completely separate from —
  → deterministic hotspot layer (lib/game-session/crime-scene.ts, unchanged)
  → deterministic evidence discovery (lib/game-session/discovery.ts, unchanged)
```

**The generated image is purely visual dressing, never authoritative.**
`buildCrimeSceneVisualDescriptor` takes only `GuiltSafeLocationFields`
(`Pick<Location, "id" | "type">`) + the crime timestamp — it structurally
cannot see `CaseTruth` (no culprit, staging, tampering, or undiscovered
evidence can reach the prompt). The prompt itself carries an explicit
no-decisive-evidence clause telling the model never to render weapons,
blood, bodies, evidence markers, or any visually decisive clue — real
evidence stays a separate, deterministic overlay CASELINE already owned
before this pass and did not change.

`CRIME_SCENE_PROMPT_VERSION`/`CRIME_SCENE_GENERATION_VERSION` (both now 2)
are independent of `CHARACTER_PROMPT_VERSION`/`CHARACTER_PORTRAIT_GENERATION_VERSION`
— bumping one never invalidates the other's cached assets (verified live:
the 6 already-`ready` portraits from the earlier pilot stayed `ready` and
untouched after this crime-scene version bump).

**Model output-size constraint**: `@cf/black-forest-labs/flux-1-schnell`
(current provider) exposes only `prompt` and `steps` as input parameters
per Cloudflare's own current documentation — no width/height/aspect-ratio
control, square output only (confirmed empirically at 1024×1024 for
portraits). A newer model family on the same platform, FLUX.2
(`flux-2-klein-9b`/`flux-2-dev`), does support width/height (256-1920px)
and flexible aspect ratios — but switching providers/models needs explicit
approval and has not been done. The renderer adapts around the square
output safely via CSS (`object-cover` inside the existing `aspect-[16/9]`
scene container, already how the procedural background renders) rather
than any server-side cropping.

Dev-only manual trigger: `/case-lab/art` (already had a crime-scene row
from the earlier milestone) shows descriptor hash/prompt version/
generation version/provider/model/status/attempts/real dimensions/signed
preview/fallback-active for the crime scene, with a single manual
"Générer" button — same gating as the portrait pilot, no production
control, no automatic generation anywhere.

## Next decision (not made by this milestone)

Wiring `getOrGenerateAsset()` into real gameplay screens (dossier,
interrogation, evidence board, accusation, truth reveal) — deliberately
left until after the first real pilot images have been generated via
`/case-lab/art` and manually inspected for quality/consistency/fairness
(see the chat summary delivered alongside this milestone). Building UI
wiring against art nobody has looked at yet risks shipping something that
needs to be redone.
