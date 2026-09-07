# CASELINE

CASELINE is a procedurally-generated police investigation game. Every case is
built by a deterministic simulation engine — a population of people, their
relationships, a full day's worth of movement and conversation, a homicide,
and everything it leaves behind — **before** the player ever sees it. The
player's job is to reconstruct that hidden truth from evidence, testimony,
and contradictions. The engine never adapts the truth to match what the
player has found; it is fixed at generation time.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the project layout,
[GAME_ENGINE.md](./GAME_ENGINE.md) for how the simulation works,
[CASE_GENERATION.md](./CASE_GENERATION.md) for the generation pipeline in
detail, and [ROADMAP.md](./ROADMAP.md) for what's built vs. planned.

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Case Lab (development only)

`/case-lab` is a developer tool that generates a case and displays its full
hidden truth — timeline, evidence, relationships, knowledge graph, validation
result, solvability score. It refuses to render outside development
(`NODE_ENV=production`). Use it as `/case-lab?seed=CASE-XXXXXX&difficulty=investigator`.

## Scripts

| Script                 | Purpose                                    |
| ----------------------- | ------------------------------------------- |
| `npm run dev`           | Start the Next.js dev server                |
| `npm run build`         | Production build                            |
| `npm test`              | Run the engine's test suite (Vitest)        |
| `npm run typecheck`     | Strict TypeScript check, no emit            |
| `npm run lint`          | ESLint                                      |
| `npm run format`        | Prettier (write)                            |

## Project status

Phases 1–5 of the roadmap (core engine, evidence engine, witness/knowledge
engine, validator, Case Lab) are implemented and tested. Gameplay UI
(dashboard, interrogation, accusation) is not yet built — see
[ROADMAP.md](./ROADMAP.md).
