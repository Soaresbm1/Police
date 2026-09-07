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

- **Phase 10 (partial) — Evidence Board.** `/investigation/tableau`: a real
  React Flow canvas (`@xyflow/react`) backed by `session.board`
  (nodes/edges persisted server-side, survives reload). A palette lists
  every person plus every *discovered* evidence item and location; clicking
  one drops it on the board. Dragging a node persists its new position
  (verified in-browser); connecting two nodes to record the player's own
  hypothesis is implemented with the standard `onConnect`/`addEdge` API and
  type-checks, but pixel-precise handle-to-handle dragging wasn't
  confirmed working end-to-end in this session's automated browser (the
  automation couldn't reliably hit the ~8px connection handles — a tooling
  precision limit, not a known code defect). Worth a manual pass with a
  real mouse before calling this fully verified.

Test suite: `lib/game-engine/__tests__` (RNG, travel math, validator rules
in isolation, portrait-service determinism, a statistical batch-generation
regression test). `npm run typecheck`, `npm run lint`, and `npm run build`
all clean.

## Known limitation: session storage is in-memory

`lib/game-session/store.ts` holds session state in a module-level `Map` —
it does not survive a server restart and does not scale past one process.
This is intentional for now (see `DATABASE.md`): building real persistence
against a gameplay UI that didn't exist yet would have meant designing the
schema twice. `CaseTruth` itself is never stored — it's regenerated
on-demand from `session.seed`, so the only state that would need a real
backing store is genuinely small (evidence status, notes, player timeline,
interrogation log, mandates, accusation).

## Not started

- **Phase 9 — Save/Auth.** Supabase Auth + persistence, replacing the
  in-memory store above. Blocked on the user providing a Supabase project
  (URL + keys) — this repo will not fabricate a fake backend integration.
- **Phase 10 — Polish (remaining).** Sound architecture, career mode
  (grade/XP — needs Phase 9's persistence), phone/vehicle/criminal-record
  lookup apps as their own "software" screens (currently folded into a
  single "dossier numérique" action per person), manual `CaseDefinition`
  JSON loading for hand-authored cases. The evidence board itself is
  done — see above.

## Explicitly deferred (by design, not oversight)

- Accomplices, crime types other than homicide — the type system supports
  them (`accompliceIds`, `CrimeType`) but the generator only produces
  single-culprit homicides. Extending this is additive, not a rewrite.
- Any LLM/external-API dependency in the generation path — the engine is
  and must stay fully algorithmic; an LLM may only ever rephrase, per the
  `NarrativeProvider` boundary. The interrogation UI is built against that
  same boundary today (`TemplateNarrativeProvider`-shaped data), so a real
  LLM provider can be swapped in later without touching engine or session
  code.
- Person portraits are a deterministic generated avatar
  (`portraits/portrait-service.ts`), not an AI image generator — the
  interface is written so a future implementation can swap in without any
  caller changing (brief §34).
