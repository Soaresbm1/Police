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

## Status: Cloudflare Workers AI pilot provider implemented, not yet triggered for real

`lib/art/generation/providers/cloudflare-provider.ts` implements
`GeneratedAssetProvider` against Cloudflare Workers AI's
`@cf/black-forest-labs/flux-1-schnell` (called via the plain REST API —
this is a Next.js app, not a Worker, so there's no `env.AI` binding).
`lib/art/generation/active-provider.ts` picks it automatically once
`CLOUDFLARE_ACCOUNT_ID`/`CLOUDFLARE_API_TOKEN` are both set in the
environment; with either missing, `activeGeneratedAssetProvider` resolves
to the null provider and CASELINE stays 100% procedural, no crash.

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
off the response's `content-type` header — confirmed empirically once the
first real request runs (see the pilot report).

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

## Next decision (not made by this milestone)

Wiring `getOrGenerateAsset()` into real gameplay screens (dossier,
interrogation, evidence board, accusation, truth reveal) — deliberately
left until after the first real pilot images have been generated via
`/case-lab/art` and manually inspected for quality/consistency/fairness
(see the chat summary delivered alongside this milestone). Building UI
wiring against art nobody has looked at yet risks shipping something that
needs to be redone.
