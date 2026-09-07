# Case Generation Pipeline

`lib/game-engine/case-generator/case-truth.ts#generateCase(seed, options)` is
the single entry point. It runs the following steps, in order, and returns a
`CaseTruth` (server-only; see `ARCHITECTURE.md`).

1. **Seed → root RNG.** `createRootRng(seed)`. Every later step derives its
   own named sub-stream from this (see "Determinism" in `ARCHITECTURE.md`).
2. **Town infrastructure.** Fixed set of public locations (see
   `GAME_ENGINE.md#the-town`).
3. **Population.** People sized by `DIFFICULTY_CONFIGS[difficulty]`
   (`suspectCount`, `witnessCount`), each with a home, optional workplace,
   personality, wealth, phone, vehicle.
4. **Relationships.** A social graph over the whole cast — not just the
   eventual suspects — so that victim selection (next step) has real
   material to work with.
5. **Victim selection.** Guaranteed to have at least one real motive
   candidate against them (see `GAME_ENGINE.md#victim-and-motive-selection`).
6. **Motive candidates → culprit.** `deriveMotiveCandidates` +
   `pickCulprit`, weighted by motive strength.
7. **Day simulation.** `simulateCaseDay` — baselines, evenings, the crime
   sequence, the autopsy, and the discovery. Produces the full
   `TimelineEvent[]` and derived facts (`crimeTimestamp`, `crimeLocationId`,
   `weapon`, `method`, `premeditated`, `caseOpenedAt`).
8. **Evidence derivation.** Every event's `evidenceSourceTags` become
   concrete `Evidence` records; red herrings are attached to other,
   non-culprit motive candidates.
9. **Knowledge graph.** One `KnowledgeFact` per person present at each
   observable event, with perception/memory quality and possible innocent
   corruption; one hop of gossip propagation.
10. **Alibis.** True location (from the timeline) vs. claimed location, for
    the culprit and the other selected suspects.
11. **Testimony.** What each person actually says when asked about each
    fact they hold — truthful, a lie (matching their alibi), an omission
    (protecting the culprit), or vague.
12. **Assembly + roles.** Victim/culprit/witness/bystander roles are
    stamped onto each `Person`, and the full `CaseTruth` object is returned.

`validateCase(truth)` (in `validator/case-validator.ts`) is a **separate**
step, deliberately not called inside `generateCase` — callers (Case Lab, the
batch tool, tests) decide when to validate, and a caller in a real game
service is expected to retry with a new seed on the rare invalid/thrown case
(see `ARCHITECTURE.md#testing-philosophy`; the batch test tolerates a small,
bounded failure rate as a normal characteristic of procedural generation,
not a defect to chase to zero).

## Why the order matters

Every later step only ever *reads* facts established by an earlier one; none
of them go back and adjust an earlier step to "make the case work" — for
example, the victim isn't picked and then a motive invented for whoever
became the culprit. Motive candidates are computed for a hypothetical victim
*before* they're chosen, from relationships built without knowledge of who
will end up victim or culprit. This is the direct implementation of the
project's core constraint: the truth is generated once, and the engine never
edits it after the fact to fit the player (or the generator's own
convenience).

## Difficulty presets

`case-generator/difficulty.ts`:

| Difficulty     | Suspects | Witnesses | Evidence contamination | Red herrings |
| -------------- | -------- | --------- | ----------------------- | ------------- |
| `recruit`      | 4        | 6         | 3%                      | 1             |
| `investigator` | 5        | 7         | 6%                      | 2             |
| `inspector`    | 5        | 8         | 9%                      | 3             |
| `expert`       | 6        | 10        | 12%                     | 4             |

## Batch generation (bug hunting)

`case-generator/generate-batch.ts#generateBatch(count, difficulty)` generates
`count` fresh cases (random seeds) and validates each one, returning a
summary (valid/invalid/thrown counts, average solvability, the most common
error messages). This is the tool referenced in the project brief's mandate
to "generate 1000 cases and detect statistical engine errors" — see
`lib/game-engine/__tests__/batch.test.ts` for how it's used as a regression
test, and the Case Lab UI for generating and inspecting one case at a time.
