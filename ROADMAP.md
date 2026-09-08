# Roadmap

Status as of this build. Phases match the project brief's build order —
engine first, UI last.

## Done

- **Phase 1 — Core engine.** Deterministic seeded RNG with independent
  derived streams; Person/Location/Relationship/TimelineEvent/CaseTruth
  types; town + population + relationship-graph generation; motive-driven
  victim/culprit selection; forward-scheduled day simulation and crime
  sequence; autopsy.
- **Phase 2 — Evidence engine.** Evidence derived from timeline event tags
  (physical/digital/video/financial/testimonial), lab analysis durations,
  red herrings grounded in real alternate suspects.
- **Phase 3 — Witness engine.** Perception/memory quality, innocent
  corruption (error vs. lie), one-hop gossip propagation, testimony
  generation (truthful/lie/omission/vague), alibi true-vs-claimed
  derivation.
- **Phase 4 — Validator.** Core-fact checks, timeline physicality
  (no teleportation, no impossible double-presence), knowledge-graph
  causality, alibi consistency, solvability scoring
  (`MIN_INDEPENDENT_CHANNELS`).
- **Phase 5 — Case Lab.** Dev-only page (`/case-lab`) to generate a case by
  seed/difficulty and inspect the full hidden truth, validation result, and
  solvability breakdown.
- **Phase 6 — Gameplay dashboard + case briefing.** `lib/game-session/`
  layer (session store, discovery/mandate rules, player-safe views,
  scoring) sitting between the engine and the UI. Commissariat dashboard
  (`/`), case briefing (`/investigation/affaire`) with crime-scene
  examination, suspects/witnesses lists with live evidence counts and
  generated avatars, a person detail screen (alibi assessment, digital/bank
  records, camera footage, search/bank warrants with a real grant-or-refuse
  rule, evidence cards with lab submission), an evidence board list
  (`/preuves`), a chronology screen mixing evidence-derived facts with the
  player's own tagged hypotheses (confirmed/probable/hypothesis/contested),
  and a relations screen that only reveals a relationship once
  investigation has actually surfaced it.
- **Phase 7 — Interrogation.** Per-person topic list derived straight from
  `KnowledgeFact`/`TestimonyLine`, chronologically ordered so topics can be
  cross-referenced against evidence timestamps found elsewhere; asking a
  question surfaces any witness-statement evidence tied to that person and
  advances the game clock. The engine's stance (lie/omission/vague) is
  never shown to the player — only the statement — matching the "player
  draws the conclusion" design constraint (brief §15).
- **Phase 8 — Accusation + report.** Accusation form (culprit/motive/
  weapon), `scoreAccusation()` comparing the accusation to `CaseTruth`
  (never the reverse), a graded report (D–S) with the full evidence/
  mandate/interrogation breakdown, and the "what really happened" reveal
  with the complete real timeline.

All of Phase 6–8 was manually played through in a real browser session
(dashboard → generate case → examine scene → dossier lookups → warrant
request → lab submission → time advance → interrogation → accusation →
report) across two difficulties, catching and fixing three real bugs along
the way (a `CaseBriefing` suspect/witness miscount, a duration formatted as
a clock time, a header that clipped off-screen at narrow widths).

- **Phase 10 — Evidence Board.** `/investigation/tableau`: a real
  React Flow canvas (`@xyflow/react`) backed by `session.board`
  (nodes/edges persisted server-side, survives reload). A palette lists
  every person plus every *discovered* evidence item and location; clicking
  one drops it on the board. Dragging a node persists its new position, and
  handle-to-handle dragging to connect two nodes was confirmed working
  end-to-end in-browser (create, persist, survive reload) after the visual
  overhaul enlarged the connection handles and added `connectionRadius` —
  see the "Game UX overhaul" entry below for the real positioning bug this
  same pass found and fixed along the way.

- **Phase 10 (continued) — Police software suite.** Six separate in-universe
  applications under `/investigation/applications`, each with its own
  search constraints rather than a shared generic data table:
  - **Téléphonie** — exact-match search by phone number only (no browsing);
    returns a real subscriber + a chronological call/SMS/geolocation/wifi
    log. Deep-links from a suspect's profile with their number pre-filled.
  - **Véhicules** — plate lookup accepting partial input (a witness who got
    a good look now remembers the canton and trailing digits, never the
    letters — `witness/knowledge-graph.ts#partialPlate`), which can return
    zero, one, or several ambiguous matches the player has to cross-check.
  - **Casier judiciaire** — local, no-network-cost name autocomplete over
    the public roster, then a per-person extract. Records are derived
    on-the-fly from existing traits (`criminal-record.ts`: aggressiveness,
    honesty, impulsivity, addictions) — nothing new was added to
    `CaseTruth`, so it can never leak hidden truth, only flavor.
  - **Vidéosurveillance** — footage is requested by location *and* a fixed
    6-hour archive slot, never freely browsed; a wrong slot returns nothing
    with a hint that other footage exists outside the window, encouraging
    the player to actually reason about timing instead of scanning everything.
  - **Consultation bancaire** and **Mandats** — both route through the same
    warrant-grant rule as before (`mandates.ts`: requires at least one
    already-discovered, non-red-herring piece of evidence linking that
    person to the case), now presented as an actual request/response
    workflow with a visible case log, rather than a single inline button.
  
  Every search action costs a small amount of in-game time
  (`app-actions.ts`), all read `CaseTruth`/`GameSession` exactly like the
  original discovery actions (never a separate or looser truth boundary),
  and generic home names ("Maison privée" ×3) are disambiguated with the
  street address wherever an app has to list several
  (`player-view.ts#displayLocationName`) — a real ambiguity bug caught and
  fixed during playtesting.

- **Phase 10 (continued) — Sound architecture.** `lib/sound/sound-manager.ts`
  synthesizes short, quiet tones via the Web Audio API (no audio files to
  ship or 404) behind a `playSound(name)` call a future asset-backed
  implementation could drop in behind unchanged. A mute toggle
  (`SoundToggle`, header) persists to `localStorage`; sounds are wired only
  at meaningful moments (a lookup succeeds/fails, a mandate is
  granted/refused, an incriminating record turns up) — deliberately not on
  every click, per "subtle and optional."

A full case was played start to finish in a real browser session using only
these new tools — generate → examine scene → Téléphonie (found a lure SMS to
the victim + a geolocation ping at the crime scene during the death window,
contradicting the suspect's home alibi) → Véhicules → Casier → Mandats
(requested and executed a search warrant) → Banque → interrogation → a
correct accusation, confirmed by the reveal report (right culprit, right
method, real motive was a debt-driven fear of denunciation). One real bug
was caught and fixed in that pass (ambiguous "Maison privée" entries in the
Vidéosurveillance location list).

Test suite: `lib/game-engine/__tests__` and `lib/game-session/__tests__`
(RNG, travel math, validator rules in isolation, portrait-service and
criminal-record determinism, a statistical batch-generation regression
test). `npm run typecheck`, `npm run lint`, and `npm run build` all clean.

- **Game UX / immersion overhaul.** A presentation-layer pass (engine and
  session logic untouched) to stop the app reading as a generic dashboard:
  - New visual system (`app/globals.css`): a grounded charcoal/graphite/
    brass palette, square corners everywhere (`* { border-radius: 0 }`,
    a deliberate art-direction choice), a condensed display font (Oswald)
    for chrome, a typewriter font (Courier Prime) for report/document
    content, and reusable `panel`/`btn`/`stamp`/`data-id` primitives placed
    in `@layer components` specifically so a Tailwind utility class still
    wins when combined with one (e.g. `panel border-l-danger`).
  - A real title screen (`components/menu/MainMenu.tsx`) replacing the old
    dashboard-as-homepage, and a skippable case-opening sequence
    (`CaseIntroOverlay.tsx`, gated per-seed via `sessionStorage` so it plays
    once per case) between generating a case and landing on the dossier.
  - A persistent game shell (`components/shell/`) — a top status bar
    (case ref, clock, lab-queue indicator, sound toggle) and a grouped icon
    rail — replacing the old plain sidebar + header, wired into
    `app/investigation/layout.tsx`.
  - The dossier, suspect/witness profiles, and interrogation room
    (`app/investigation/{affaire,personnes,interrogatoires}/...`) rebuilt
    around the panel/stamp system (`DOSSIER N° CL-...`, `CONFIDENTIEL`/
    `EN COURS` stamps, a transcript-styled interrogation log) instead of
    generic cards.
  - Portraits (`portraits/portrait-service.ts`) regenerated as monochrome
    "police database" ID photos (corner registration ticks, scanlines, a
    fake `ID-######` code) rather than colorful chat-app avatars — the
    `PersonPortraitService` interface is unchanged, so a future real
    image-generation backend still drops in without touching callers.
  - All six police apps re-themed with a shared identity (bracketed
    `AppFrame` header, a monospace record table, a database-style person
    picker) plus per-app touches (a fake Swiss-style plate chip in
    Véhicules, a REC-indicator monitor frame in Vidéosurveillance).
  - Evidence board: cork-board background, evidence-card-styled nodes,
    enlarged connection handles plus a larger `connectionRadius`, and a
    real bug fix (see below) — connection dragging is now confirmed
    working end-to-end in-browser, closing out the item Phase 10 had
    flagged as unverified.
  - **Real bug found and fixed in this pass:** `EvidenceBoard.tsx`'s node
    style object included a conditional `transform` key (for tilting note
    cards) that was `undefined` for every non-note node. React Flow relies
    on owning `transform` on the node's outer style for positioning, and an
    explicit `transform: undefined` key still overwrites it on merge — so
    every node beyond the first ended up stacked at the same screen
    position. Fixed by moving the tilt onto an inner wrapper `div` instead
    of the node's own style; verified via a `nodes.map(n => n.position)`
    debug readout, then removed. This was **not** a pre-existing bug — it
    was introduced by this pass's node restyling and caught by the
    mandated in-browser retest before being reported as done.
  - Follow-up items from this pass, all completed in the next pass below:
    a spatial crime-scene screen, a standalone lab screen, an investigation
    map, a stepped truth reveal, a settings overlay, and onboarding hints.

- **Immersion pass 2 — remaining ROADMAP items.**
  - **Spatial crime scene** (`/investigation/scene`,
    `lib/game-session/crime-scene.ts`, `CrimeSceneScreen.tsx`): the crime
    scene is now a room with 8 clickable numbered hotspots instead of one
    "examine" button. `getCrimeSceneHotspots()` is a pure presentation
    layer — it deterministically assigns the *same* discoverable evidence
    set `discovery.getCrimeSceneEvidence()` already produced to a fixed
    pool of generic room props (table, window, door, floor...), hashed by
    evidence id so the layout is stable per case; leftover prop slots
    become flavor-only decoys ("Rien de particulier ici.") — never fake
    evidence, just an honest empty result. One hotspot is always "Le
    corps" showing the (already-public) autopsy summary. Inspecting a
    hotspot reveals exactly one evidence item via the new
    `discovery.inspectCrimeSceneHotspot()`, and the panel offers the same
    Prélever/Envoyer-au-laboratoire actions evidence cards already have.
  - **Forensic lab** (`/investigation/laboratoire`): a real queue with a
    progress bar per job (`(currentTime - submittedAt) / (readyAt -
    submittedAt)`), an "en attente d'envoi" section for discovered/
    collected evidence not yet sent, and a "rapports disponibles" section
    once `advanceTime` marks a job analyzed — all reading existing
    `session.labQueue`/`evidenceStatus`, no new engine or session rules.
  - **Investigation map** (`/investigation/carte`,
    `player-view.ts#getMapLocations`): plots the crime scene, every
    person's home/work (already public elsewhere in the UI), and any
    location tied to *discovered* evidence — using each location's real
    `coordinates` (the engine's 8×8km grid) normalized to percentages. A
    location whose only significance is undiscovered evidence gets no
    marker, so the map can't hint at hidden truth. Selecting a location
    draws a dashed line to the crime scene and shows real
    `travelMinutes()` (car/foot) from it, so alibi-vs-geography
    contradictions ("he says he walked, but that's 45 minutes on foot")
    become visible at a glance.
  - **Stepped truth reveal** (`rapport/page.tsx` +
    `TruthRevealSequence.tsx`): the final report is now five short beats
    (dossier transmis → accusation result/grade → correctness breakdown →
    reconstructed true timeline → closing stats) navigated with a
    "Suivant" button and a "Tout afficher" skip link, instead of one long
    scrolling page. No forced delays — every beat advances on click.
  - **Settings overlay + ESC** (`components/shell/SettingsOverlay.tsx`):
    Échap toggles a panel (sound, a manual "reduced motion" toggle wired to
    a `[data-reduce-motion]` CSS rule, and an onboarding-hints toggle),
    reachable in-game from the top bar and from the main menu.
  - **Onboarding hints** (`OnboardingHint.tsx`): small dismissible tips on
    the dossier, Téléphonie, and the evidence board, each independently
    dismissible and with a "Désactiver les astuces" link that turns them
    all off via `localStorage`. Pragmatic scope note: this is "shown until
    dismissed," not tied to an actual first-case counter — the project
    doesn't persist a cases-played count anywhere yet (that's Phase-9-
    adjacent), so `localStorage` dismissal is the honest equivalent within
    a single browser.
  - **Real bug found and fixed in this pass:** `app-actions.ts` (a `"use
    server"` file) had gained a `export const RECORD_TYPE_LABEL = {...}`
    — Next.js only allows a `"use server"` module to export async
    functions, so this crashed every screen that imported it as soon as
    `CrimeSceneScreen` pulled it in. Fixed by moving the constant to
    `lib/game-session/labels.ts` (a plain module) and updating both call
    sites. Caught during the mandated in-browser retest, not by
    `tsc`/`eslint` (both were clean — this is a Next.js runtime-only rule).

- **Phase 9 — Supabase persistence.** `CaseTruth` still never touches
  storage (see `DATABASE.md`); everything else a player produces now
  survives a server restart when Supabase is configured, and gracefully
  falls back to the pre-Phase-9 in-memory/anonymous-cookie behavior when
  it isn't:
  - `lib/game-session/persistence/` — a `SessionStore` interface with two
    implementations (`MemoryStore`, `SupabaseSessionStore`), picked by
    `getStore()` based on `lib/supabase/config.ts#isSupabaseConfigured()`.
  - `lib/game-session/with-session.ts#withSession()` replaced the old
    `requireSession()` helper in both `actions.ts` and `app-actions.ts`:
    it fetches the active session, runs the action's mutation (in-place,
    same as before), then persists the result through whichever store is
    active — including the evidence-board actions, which don't
    revalidate but still need to save.
  - `lib/game-session/identity.ts#getCurrentIdentity()` resolves who's
    playing: a Supabase `auth.uid()` when configured, or an anonymous id
    assigned by `proxy.ts` (the renamed `middleware.ts` — see below)
    otherwise. Cookies can only be written from Proxy/Server
    Actions/Route Handlers, never a plain render, which is why the
    anon-id assignment lives in `proxy.ts` and not in `identity.ts`
    itself (an earlier version tried the latter and hit exactly that
    Next.js restriction — see the Immersion pass 2 bug list below).
  - Email/password auth (`app/login/page.tsx`, `AuthForm.tsx`,
    `auth-actions.ts#signOutAction`) activates automatically once
    Supabase env vars are set; the main menu shows a login prompt instead
    of "Nouvelle affaire" until signed in, and falls back to instant
    anonymous play otherwise.
  - `supabase/migrations/0001_init.sql` — `profiles`,
    `investigation_sessions`, `case_history`, all RLS-scoped to
    `auth.uid()`, no service-role client anywhere in the app.
  - Renamed `middleware.ts` → `proxy.ts` (Next.js 16 deprecated the
    `middleware` file convention in favor of `proxy` — caught by a build
    warning, not a training-data assumption; see AGENTS.md's standing
    reminder to check `node_modules/next/dist/docs/` before assuming API
    shapes in a new Next.js version).

- **Career mode foundation.** `profiles.rank`/`xp`/`cases_solved`/
  `cases_failed`/`accusations_total`, updated atomically with each
  archived case by `SessionStore#completeCase` (`lib/game-session/
  career.ts` holds the pure rank-threshold/XP-per-grade logic, shared by
  both store implementations so they can't drift). The main menu shows
  the player's rank, XP, and solved count; `/dossiers` lists every
  completed case with its grade, and `/dossiers/[id]` replays that case's
  report through the same `TruthRevealSequence` component the live
  report uses — same data shape, sourced from the stored `accusation` +
  `score` instead of a live session. No achievements system yet, per the
  brief's own "don't overbuild" instruction.

- **Content breadth: evidence tampering.** `EvidenceReliability` already
  had an unused `"falsified"` value; `evidence-generator.ts` now rolls a
  small, separate chance (`tamperingChance`, default 3%, rarer than plain
  contamination) for physical trace evidence (fingerprint/DNA/blood/
  fiber/shoeprint/tire-track) to come back `"falsified"` with a
  description noting manipulation was detected. Uses the exact same
  mechanism `solvability.ts` already tolerates for `"contaminated"`
  evidence (channel-counting is by evidence *family*, not reliability),
  so this couldn't regress solvability — confirmed by the existing
  statistical batch-generation test staying green. The other content-
  breadth items from this pass's brief (accomplices, staged scenes,
  accidental-death-as-homicide, false confessions, shared vehicles/
  phones) were **not** attempted: each is a real structural change to
  case generation (crime-planner, motive, alibis) and doing them
  properly — without quietly weakening the validator/solvability
  guarantee the brief explicitly said to keep strict — needs more room
  than this pass had left. They're good candidates for a dedicated
  future pass, one at a time, each re-verified against the batch test.

- **Art pipeline architecture.** `lib/art/providers.ts` defines
  `CrimeSceneImageProvider`, `EvidenceImageProvider`, `CCTVFrameProvider`,
  and `LocationImageProvider` — the same contract `PersonPortraitService`
  (`portraits/portrait-service.ts`, left where it is) already established:
  given a deterministic seed, return a stable, cacheable image URL, with
  no caller ever knowing or caring how it was produced. Each has a
  procedural default implementation (inline SVG, no network, no AI
  dependency) so the interfaces are real and working today, not stubs —
  but none of the existing screens (crime scene, evidence cards, camera
  frames) have been rewired to consume them yet. That rewiring is
  low-risk future work; defining the seam was the point of this item.

- **Atmosphere/audio foundation.** `lib/sound/sound-manager.ts` grew a
  proper gain graph — `master → { ui, ambience } → destination` — with
  persisted per-group volumes (`getVolume`/`setVolume`, sliders in
  `SettingsOverlay`) on top of the existing hard mute. `ambience.start
  ("office")` (a lowpass-filtered noise bed + a 60Hz hum, both synthesized)
  runs for the lifetime of the investigation shell
  (`AmbiencePlayer.tsx`, mounted in `GameShell`); `ambience.start("rain")`
  exists as an alternate texture, not yet triggered by anything.
  `ambience.duck()` briefly lowers the bed for the two most tense beats —
  stepping into an interrogation room (`InterrogationAmbienceDuck.tsx`)
  and the grade/truth reveals in `TruthRevealSequence`. Still entirely
  synthesized, matching the project's no-external-asset rule; a
  real ambience loop can replace `startOffice`/`startRain` later without
  touching any caller.

- **World identity.** `lib/game-engine/world/city.ts`: the town has a
  name (`Vironval`, already existed), a police department identity
  (`Police cantonale de Vironval`), six named districts with their own
  street pools (`districtForCoordinates` picks one from a location's
  actual coordinates, so an address's street is always consistent with
  where the building stands on the map), and a real case-numbering
  scheme (`formatCaseNumber` → `CL-2026-0421`, deterministic per seed,
  replacing the raw seed string everywhere a case reference is shown:
  dossier header, top bar, case intro, report, case history). `Location`
  gained a `district` field, surfaced on the investigation map's info
  panel.

- **Immersion pass 2 bugs found and fixed:**
  - `getCurrentIdentity()` originally tried to *write* the anonymous
    player cookie from inside a Server Component render path, which
    Next.js rejects ("Cookies can only be modified in a Server Action or
    Route Handler"). Fixed by moving cookie assignment into `proxy.ts`
    (runs before any render) and making `identity.ts` read-only.
  - That same `proxy.ts` fix initially mutated `request.cookies` *after*
    already calling `NextResponse.next({ request })`, which snapshots the
    request — the new cookie never reached the render it was meant to
    unblock. Fixed by reordering: mutate the request's cookie jar first,
    construct the response after.
  - `app-actions.ts` (a `"use server"` file) had picked up a plain
    `export const RECORD_TYPE_LABEL = {...}` object — Next.js only allows
    async function exports from a `"use server"` module, which crashed
    every screen importing it. Fixed by moving the constant to
    `lib/game-session/labels.ts`. Caught by the mandated in-browser
    retest, not `tsc`/`eslint` (a Next.js runtime-only rule).
  - `TruthRevealSequence`'s final "closing" card and its timeline step
    shared the same step index (`STEP_COUNT` was one short), so both
    rendered stacked together instead of as distinct steps. Fixed by
    bumping `STEP_COUNT` to 5.

## Known limitation: session storage falls back to in-memory

Without Supabase configured, `lib/game-session/persistence/memory-store.ts`
holds session/profile/case-history state in module-level `Map`s — it does
not survive a server restart and does not scale past one process. This is
now purely a *fallback*, not the only option (see `DATABASE.md` for the
Supabase setup that removes this limitation). `CaseTruth` itself is never
stored in either backend — it's regenerated on-demand from `session.seed`.

## Not started

- **Phase 10 — Polish (remaining).** Manual `CaseDefinition` JSON loading
  for hand-authored cases. Career mode's foundation (rank/XP/history) is
  done — see above; achievements/leaderboards were deliberately not
  built yet.
- **Content breadth beyond evidence tampering** — accomplices, staged
  crime scenes, accidental death disguised as homicide, false
  confessions, suspects sharing a vehicle/phone, a wider weapon/method
  vocabulary. See the "Content breadth" entry above for why these were
  deferred rather than rushed.
- **Rewiring the art providers** into the screens that could use them
  (crime scene background, evidence card thumbnails, CCTV frame
  previews) — the interfaces and default implementations exist
  (`lib/art/providers.ts`) but nothing calls them yet.
- **Rain ambience trigger** — `ambience.start("rain")` works but nothing
  in the game currently decides when weather should be raining.

## Explicitly deferred (by design, not oversight)

- Crime types other than homicide — the type system supports it
  (`CrimeType`) but the generator only produces homicides.
- Any LLM/external-API dependency in the generation path — the engine is
  and must stay fully algorithmic; an LLM may only ever rephrase, per the
  `NarrativeProvider` boundary. The interrogation UI is built against that
  same boundary today (`TemplateNarrativeProvider`-shaped data), so a real
  LLM provider can be swapped in later without touching engine or session
  code.
- Person portraits are a deterministic generated avatar
  (`portraits/portrait-service.ts`), not an AI image generator — the
  interface is written so a future implementation can swap in without any
  caller changing (brief §34). The four newer providers in
  `lib/art/providers.ts` follow the same pattern.
- Localization and controller support — explicitly out of scope for this
  milestone per the brief.
