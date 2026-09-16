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
detail, [UNITY_RECONSTRUCTION.md](./UNITY_RECONSTRUCTION.md) for the Unity CCTV
renderer and the post-case 3D crime reconstruction, and
[ROADMAP.md](./ROADMAP.md) for what's built vs. planned.

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and click **Générer
l'affaire** to start a case. The loop: examine the crime scene, look up
suspects' digital/bank records and request search warrants, send physical
evidence to the lab and advance the clock while it's analyzed, interrogate
suspects and witnesses, cross-reference their statements against what
you've found (optionally pinning people/evidence/locations onto the
`/investigation/tableau` evidence board as you go), then submit an
accusation to the prosecutor and see the full reveal report.

Session state (which evidence you've found, your notes, your own timeline
hypotheses) is stored in Supabase when it is configured, with accounts and
row-level security — see [DATABASE.md](./DATABASE.md). Without Supabase it
falls back to server memory for the life of the dev process — see
`ROADMAP.md`'s "known limitation" note.

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

Phases 1–8 of the roadmap are implemented and tested: the core simulation
engine, evidence and witness/knowledge engines, validator, Case Lab, and a
fully playable gameplay loop (dashboard, case briefing, suspects/witnesses,
evidence + lab, chronology, relations, interrogation, accusation, and the
graded reveal report), persistence with accounts (Phase 9), and the polish
layer built since: evidence board, sound and ambience, career ranks, generated
art. What remains is listed in [ROADMAP.md](./ROADMAP.md).

A shared Unity WebGL runtime renders CCTV footage during the investigation
and, once a case is resolved, a truth-safe 3D reconstruction of what really
happened (desktop only; the written reconstruction stays available on mobile).
See [UNITY_RECONSTRUCTION.md](./UNITY_RECONSTRUCTION.md).
