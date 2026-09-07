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

Test suite: `lib/game-engine/__tests__` (RNG, travel math, validator rules
in isolation, a statistical batch-generation regression test). All green;
`npm run typecheck` and `npm run lint` clean.

## Not started

- **Phase 6 — Gameplay UI.** Dashboard, case briefing (truth-stripped),
  suspects/witnesses/evidence/timeline/map/relations screens, evidence
  board (React Flow), player-built timeline with confirmed/probable/
  hypothesis/contested tagging.
- **Phase 7 — Interrogation.** Interactive questioning UI over the existing
  `TestimonyLine`/`KnowledgeFact` data; confrontation with evidence; the
  `NarrativeProvider` abstraction (template-based first, LLM-backed later)
  to turn factual testimony into natural dialogue without ever letting the
  narrative layer decide truth.
- **Phase 8 — Accusation + report.** Final accusation flow, comparison
  against `CaseTruth`, scoring/grading, the "what really happened" reveal.
- **Phase 9 — Save/Auth.** Supabase Auth, case/progress persistence (see
  `DATABASE.md`).
- **Phase 10 — Polish.** Visual design pass, audio architecture, portrait
  service, career/progression, warrants, phone/vehicle/bank/camera lookup
  tools, manual `CaseDefinition` JSON loading for hand-authored cases.

## Explicitly deferred (by design, not oversight)

- Accomplices, crime types other than homicide — the type system supports
  them (`accompliceIds`, `CrimeType`) but the generator only produces
  single-culprit homicides. Extending this is additive, not a rewrite.
- Any LLM/external-API dependency in the generation path — the engine is
  and must stay fully algorithmic; an LLM may only ever rephrase, per the
  `NarrativeProvider` boundary.
