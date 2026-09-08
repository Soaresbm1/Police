# Architecture

## Principle

The **game engine is independent of the UI**. Nothing under `lib/game-engine`
imports React, Next.js, or any rendering concern. It is pure, deterministic
TypeScript that can be unit-tested in isolation, called from a server
component, a server action, an API route, or a future dedicated backend
without change.

`CaseTruth` — the fully-generated hidden state of a case — is produced and
consumed **only on the server**, and never handed to a Client Component or
serialized into a prop. Real gameplay pages are Server Components that call
`lib/game-session` helpers, which read `CaseTruth` and return only a
player-safe projection (see "The game-session layer" below); the browser
only ever receives the rendered HTML of that projection. The Case Lab
(`/case-lab`) is the one deliberate exception — it renders the raw
`CaseTruth` for debugging — and it refuses to render outside development.

## Directory layout

```
app/                      Next.js App Router pages
  page.tsx                 Commissariat dashboard: start/resume a case
  case-lab/                Dev-only case inspector (Phase 5)
  investigation/           The gameplay shell (Phases 6-8)
    layout.tsx              Nav + game clock header, redirects home if no session
    affaire/                 Case briefing + crime scene examination
    suspects/, temoins/      Person lists (with live evidence-count badges)
    personnes/[personId]/    Person detail: alibi assessment, dossier lookups,
                              warrants, linked evidence
    preuves/                 All discovered evidence, grouped by family
    tableau/                 Evidence board: a React Flow canvas of the
                              player's own connections between people,
                              evidence, and locations they've discovered
    chronologie/             Evidence-derived facts + the player's own timeline
    relations/               Relationships, revealed only once investigated
    interrogatoires/[personId]/  Ask-about-topics interrogation transcript
    notes/                   Freeform autosaved notes
    accusation/, rapport/    Final accusation form + graded reveal report
    applications/            Six separate in-universe police software tools
                              (telephonie, vehicules, casier, cameras, banque,
                              mandats) — see GAME_ENGINE.md and ROADMAP.md for
                              why each has its own search constraints instead
                              of being one generic data table

lib/
  game-engine/             The entire simulation engine (server-only, pure)
    types/                 Shared domain types: Person, Location, Relationship,
                            TimelineEvent, Evidence, KnowledgeFact, CaseTruth...
    random/                Deterministic seeded PRNG (rng.ts)
    world/                 Static town data + location instantiation
    case-generator/        Orchestration: population, relationships, motive,
                            alibis, difficulty presets, the main generateCase()
                            pipeline, and the dev batch-generation tool
    simulation/             Day scheduling (baseline + evening) and the crime
                            sequence itself (crime-planner, timeline-engine)
    evidence/               Derives Evidence[] from TimelineEvent[] + red herrings
    witness/                Perception/memory model, knowledge graph, testimony
    validator/              validateCase() and the solvability scorer
    narrative/              NarrativeProvider abstraction (template impl today)
    portraits/              PersonPortraitService (deterministic avatar today)
    __tests__/              Vitest suite for the engine
  game-session/            Play-state layer: sits between the engine and the
                            UI, still server-only but *not* part of the engine
                            (it has opinions about gameplay, the engine has none)
    types.ts                GameSession shape (evidence status, lab queue,
                             notes, player timeline, interrogation log, mandates)
    identity.ts              Resolves who's playing — Supabase auth.uid()
                             or an anonymous cookie id (see lib/supabase/)
    persistence/              SessionStore interface + two implementations
                             (memory-store.ts, supabase-store.ts), picked by
                             getStore() — see DATABASE.md
    with-session.ts           Fetch session + truth, run a mutation, persist
                             through the active store — used by every action
                             in actions.ts/app-actions.ts instead of a bare
                             in-memory lookup
    career.ts                 Pure rank/XP math, shared by both store
                             implementations so they can't drift
    current.ts               Identity → session → regenerated CaseTruth
                             accessor for Server Components
    actions.ts               "use server" mutations for the core gameplay
                             loop (examine scene, collect/lab evidence,
                             advance time, ask a question, timeline entries,
                             evidence board, submit an accusation...)
    app-actions.ts            "use server" search actions for the six police
                             apps — these *return* structured data to their
                             Client Component caller (not just revalidate +
                             redirect), since a search app renders a report
                             inline rather than navigating away
    profile-actions.ts         "use server" settings mutations — no active
                             case required, unlike everything above
    discovery.ts, mandates.ts  Evidence-reveal and warrant-grant rules,
                             shared by both actions.ts and app-actions.ts
    crime-scene.ts             Presentation layer laying the crime-scene
                             evidence set out as spatial hotspots — see
                             GAME_ENGINE.md
    criminal-record.ts        Deterministic per-person criminal history,
                             derived purely from existing personality/
                             addiction traits — flavor for the Casier
                             judiciaire app; never stored in CaseTruth,
                             can't leak hidden truth because there's no
                             hidden truth to leak, only public-safe traits
    player-view.ts            CaseTruth + GameSession → player-safe projections
                             (PersonPublicView never carries `roles`, evidence
                             lists never include undiscovered items, home
                             names are disambiguated by address, map markers
                             only for discovered locations, etc.)
    interrogation-view.ts     KnowledgeFact/TestimonyLine → askable topics
    scoring.ts                Accusation vs. CaseTruth → graded CaseScore
    labels.ts                 Shared French labels (motive types, weapons,
                             evidence type names — kept out of app-actions.ts
                             because a "use server" file can only export
                             async functions)

  supabase/
    config.ts, server.ts, client.ts  isSupabaseConfigured() + the
                             request-scoped (server) and browser Supabase
                             clients — no service-role client anywhere
    auth-actions.ts            signOutAction

  art/
    providers.ts               CrimeSceneImageProvider, EvidenceImageProvider,
                             CCTVFrameProvider, LocationImageProvider —
                             same seed-in, stable-URL-out contract as
                             portraits/portrait-service.ts, with procedural
                             default implementations; not yet wired into
                             the screens that could use them

  sound/
    sound-manager.ts          Web Audio synthesis: short UI tones plus an
                             ambience bed, behind a master/ui/ambience gain
                             graph with per-group volume and a duck() for
                             tense moments — see GAME_ENGINE.md

proxy.ts                    Runs before every render: refreshes the Supabase
                            auth cookie, or assigns the anonymous player-id
                            cookie in dev-fallback mode. Named `proxy.ts` per
                            Next.js 16's file convention (the deprecated
                            name is `middleware.ts`) — see AGENTS.md.

components/investigation/  Small presentational + the handful of Client
                            Components that need interactivity beyond a plain
                            form action (the timeline status select, the
                            interrogation topic button, the evidence board
                            canvas, the crime-scene hotspot screen)
  apps/                     The six police-software apps: each is a Client
                            Component (search state, loading, results) fed
                            by a thin server page; AppFrame/RecordTable/
                            PersonPicker are the shared chrome

components/auth/           AuthForm.tsx — email/password sign in/up,
                            calling Supabase directly from the client
                            (every other read/write in the game goes
                            through a Server Action instead)
```

## Data flow (case generation)

```
CaseSeed
  → createRootRng(seed)                         [random/rng.ts]
  → generateTownInfrastructure(rng)              [world/world-generator.ts]
  → generatePopulation(rng, infra, config)       [case-generator/population.ts]
  → generateRelationships(rng, people, locs)     [case-generator/relationships.ts]
  → selectVictim(rng, people, relationships)     [case-generator/motive.ts]
  → deriveMotiveCandidates(victim, ...)          [case-generator/motive.ts]
  → pickCulprit(rng, candidates)                 [case-generator/motive.ts]
  → simulateCaseDay(rng, ..., culprit, motive)   [simulation/timeline-engine.ts]
      → generateDailyBaseline() per person       [simulation/schedule.ts]
      → generateEveningBlock() per person        [simulation/schedule.ts]
      → planCrime()                              [simulation/crime-planner.ts]
      → forward-scheduled crime sequence + autopsy
  → deriveEvidenceFromTimeline() + red herrings  [evidence/evidence-generator.ts]
  → buildKnowledgeGraph() + gossip propagation   [witness/knowledge-graph.ts]
  → buildAlibis()                                [case-generator/alibis.ts]
  → generateTestimony()                          [witness/testimony-generator.ts]
  → assemble CaseTruth                           [case-generator/case-truth.ts]
  → validateCase(truth)                          [validator/case-validator.ts]
```

Every step derives from the previous ones. Nothing is chosen independently
"for balance" after the fact — see `CASE_GENERATION.md` for why this matters
and how each step avoids doing that.

## Determinism

`RNG` (in `random/rng.ts`) is a seeded PRNG (cyrb128 hash → sfc32 generator).
The critical design choice is `RNG.derive(label)`: instead of drawing
sequentially from one shared stream (which would make the whole case
generation fragile to any future reordering of code), every independent
concern gets its own sub-stream keyed by a string label
(`rng.derive("population")`, `rng.derive("relationships")`, etc.). Two calls
to `derive()` with the same label always produce the same stream, regardless
of what else has been drawn from the parent in between. This is what makes
`generateCase(seed)` reproducible forever, even as the engine keeps growing.

## The game-session layer and the gameplay loop

`lib/game-session` is deliberately a separate layer from `lib/game-engine`,
not a subfolder of it: the engine has no concept of "discovered" evidence,
warrants, or a player's own timeline notes — those are play-state concerns,
not simulation concerns. A `GameSession` is small (evidence-status map, lab
queue, notes, player timeline entries, interrogation log, mandate records,
the final accusation) and is looked up from a cookie
(`game-session/current.ts`). `CaseTruth` is **not** stored alongside it —
it's regenerated on every request from `session.seed` via `generateCase()`,
which is cheap and, by construction, always produces the identical case
(see "Determinism" above).

Gameplay pages are async Server Components that call `getCurrentGame()` and
then a `player-view.ts` accessor to get a safe projection — e.g.
`getVisibleEvidence()` filters out anything with status `"undiscovered"`
entirely (not hidden — absent), and `PersonPublicView` never carries the
engine's `roles` field (which is where `"culprit"` would leak). Mutations
(`game-session/actions.ts`) are Next.js Server Actions: a button's
`<form action={someAction.bind(null, id)}>` runs entirely server-side, calls
into `discovery.ts`/`mandates.ts` to decide what happens, mutates the
session in place, and calls `revalidatePath("/investigation", "layout")` so
every open tab's next render reflects the change — there is no client-side
game-state store (Zustand is installed for future use but nothing here
needs it: the server is the source of truth every step of the way).

The interrogation and accusation flow is the clearest expression of the
project's central rule: the engine decides truth once, at generation time,
and nothing downstream is allowed to edit it. `getInterrogationTopics()`
exposes a `TestimonyLine.statement` (what someone *says*) but never its
`stance` (whether that's a lie) — the player has to notice the contradiction
themselves by cross-referencing the alibi's window against evidence found
elsewhere, exactly as intended by brief §15. `scoreAccusation()` only ever
*compares* the player's accusation against `CaseTruth` after the fact; it
cannot influence what actually happened.

## Testing philosophy

The engine matters far more than the UI (see `CLAUDE.md`/project brief,
section 52). `lib/game-engine/__tests__` includes:

- RNG determinism and independence of derived streams
- Travel-time/distance math
- A hand-built `CaseTruth` fixture exercising the validator's individual
  rules in isolation (teleportation, impossible knowledge, insufficient
  solvability)
- A statistical batch test that generates hundreds of fully random cases and
  asserts a high validity/solvability rate — this is how the generator's rare
  procedural edge cases get caught, per the "generate 1000 cases" mandate.
- Determinism of `portraits/portrait-service.ts`.

The gameplay UI (Phases 6-8) has no automated end-to-end tests yet — it was
verified by actually playing it in a browser (dashboard → generate →
examine scene → dossier/camera/bank/search actions → warrant grant/refusal
→ lab submission → time advance → interrogation → accusation → report)
across two difficulties, which is how the `CaseBriefing` suspect/witness
count bug and the duration-formatted-as-a-clock-time bug were caught. A
Playwright suite covering this flow is reasonable future work but wasn't
built yet — the engine's own property-style tests were judged higher value
for the time available (brief §52: the engine is the priority).
