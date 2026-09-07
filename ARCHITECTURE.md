# Architecture

## Principle

The **game engine is independent of the UI**. Nothing under `lib/game-engine`
imports React, Next.js, or any rendering concern. It is pure, deterministic
TypeScript that can be unit-tested in isolation, called from a server
component, a server action, an API route, or a future dedicated backend
without change.

`CaseTruth` — the fully-generated hidden state of a case — is produced and
consumed **only on the server**. The only thing ever allowed to reach the
browser during real gameplay is a derived, truth-stripped view (see
`toCaseBriefing` in `lib/game-engine/types/case.ts`, and the `evidence`/
`testimony`/`alibis` arrays which are themselves safe to expose because they
are the player-facing *content*, not the hidden solution key — the fields
that must stay hidden are `culpritId`, `motive`, and any raw `TimelineEvent`
the player hasn't discovered evidence for). The Case Lab (`/case-lab`) is the
one deliberate exception, and it refuses to render outside development.

## Directory layout

```
app/                      Next.js App Router pages
  case-lab/                Dev-only case inspector (Phase 5)

lib/
  game-engine/             The entire simulation engine (server-only)
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
    narrative/              (planned) NarrativeProvider abstraction
    __tests__/              Vitest suite for the engine

types/, components/, features/, database/  (reserved for gameplay UI phases)
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
