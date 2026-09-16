# Unity CCTV and crime reconstruction

CASELINE ships one Unity WebGL runtime that serves two viewers:

- **CCTV playback** during an investigation (phases U1–U4.3), and
- the **3D crime reconstruction** shown after a case is resolved (phases U5.0–U5.5).

Both live in one scene (`unity/CaselineVisualPrototype/Assets/Scenes/CaselineEmbed.unity`) and one Brotli
build (`public/unity/cctv/Build/WebBuild.{loader.js,framework.js.br,data.br,wasm.br}`). The page mounts a single
persistent canvas and switches the runtime between `CCTVRoot` and `ReconstructionRoot` through the `EmbedMode`
object (`CaselineEmbedModeController`). Leaving reconstruction mode clears its actors, environment, session token
and camera shot, so nothing carries into CCTV or into the next reconstruction.

The Unity project never reads `CaseTruth`. Everything it shows arrives as JSON built on the server.

## Pipeline

```
CaseTruth (server only)
  → selectReconstructionEventChain()        lib/game-engine/reconstruction/reconstruction-events.ts
  → projectReconstruction()                 lib/game-engine/reconstruction/reconstruction-projector.ts
      ReconstructionScenario V1: environment kind, actors (opaque visual id, disclosed role,
      generic appearance, spawn/despawn, slot waypoints), events (time, type, slot, safe visual action)
  → release gate                            lib/game-session/reconstruction-release.ts
      active case only once an accusation is on record; archived case only for its owner
  → buildPresentationTimeline()             lib/game-engine/reconstruction/reconstruction-presentation.ts
      presentation-only pacing: "Plus tard…" skips, hold points — truth times never change
  → ReconstructionLauncher / ReconstructionViewer   components/investigation/reconstruction/
  → Unity ReconstructionWebBridge (token-guarded load / play / seek)
  → ReconstructionJsonLoader (strict validation, unknown fields rejected)
  → ReconstructionSceneController.Evaluate(time)
      → ReconstructionActorTimeline (pose = f(actor, events, time), no deltaTime state)
      → ReconstructionCameraController (shot = f(scenario, time))
```

Mobile (narrow viewports) never boots Unity for the reconstruction: the written reconstruction stays available
and a "disponible sur ordinateur" note replaces the launcher. CCTV falls back to its 2D canvas player.

## Truth boundary

- The scenario carries no seed, no `PersonId`, no motive, no evidence, no relationship and no hidden role. Actor
  ids are derived per case and opaque; roles are limited to what the reveal already discloses
  (victim, culprit, accomplice, everyone else "PERSONNE").
- Slot coordinates (`ReconstructionZoneLayout`) and camera framing are **presentation staging, not facts**.
  CaseTruth has no spatial data below the location id. The in-view disclaimer says so on every frame:
  "Reconstitution visuelle - positions spatiales indicatives".
- Crime methods map to one abstract beat each (`safeVisualAction`): strike, thrust, strangle, aimed hold, shove,
  and one neutral extended-hand interaction shared by poisoning and staged overdose. No weapon, projectile,
  drink, food, syringe or wound is ever modelled. Staging is a generic crouch that never shows what was moved.

## Presentation pacing (U5.4)

Truth time is never compressed. The viewer plays short activity windows (spawns, the last ≤ 8 s of each walk,
a 2 s attack beat, a 1.5 s collapse, 3 s event beats) and replaces any idle stretch of 30 s or more, starting 2 s
after the last activity, with a 1.2 s "Plus tard…" transition. Median watched duration over 2,000 generated
cases: about 41 s (it was about 37 min before U5.4).

## Reconstruction camera (U5.5)

The camera is deterministic and presentation-only. It never tracks, pans, zooms, shakes or interpolates, and
the player has no camera control. Code: `ReconstructionCameraPresets.cs`, `ReconstructionCameraDirector.cs`,
`ReconstructionCameraController.cs`.

### Shots

| Shot | Used for | Framing |
| --- | --- | --- |
| `Overview` | departures, anything not framed more closely | fixed world-space shot, unchanged since U5.2: position (0, 6.75, -9.78), 55° FOV |
| `Interaction` | talk, poisoning / staged overdose, staging | 7.4 m, yaw -30°, pitch 14°, 45° FOV |
| `PhysicalAttack` | strike, stab, strangle, firearm, push | 6.6 m, yaw -36°, pitch 12°, 45° FOV |
| `Discovery` | the body and whoever finds it | 7.6 m, yaw -30°, pitch 16°, 45° FOV, aimed lower |

Every slot shot is aimed at the event's semantic slot in the current environment (the midpoint of the two
people a two-person event stages there). Environments may override a shot's framing in the same table; none
needs to today, because each shot is slot-relative. A negative yaw puts the camera on the side the scene's light
falls on: actors show their lit side against lit walls, and a forward beat reaches across the screen toward the
other person.

Neutrality rules encoded in tests: a neutral interaction is never framed tighter than a physical attack;
poisoning and staged overdose always get the identical shot; firearm shares the physical-attack framing, never a
tighter one that would imply a firing distance.

### Inputs

Shot selection reads only the environment kind, each event's type, safe visual action, slot and timestamp, and,
for a departure, when the departing figure's walk starts. It reads no role, identity, motive or evidence, uses no
randomness, and adds nothing to `ReconstructionScenario`. A test renames every actor and blanks every role and
checks the shots do not change.

### Cut rule

Each event owns the shot from its shot start until the next event's shot starts:

- talk and discover cut exactly at the event's timestamp;
- attack and stage_scene cut 1 s early (`ActionLeadSeconds`), so the framing is set before the beat's first frame;
- leave_scene cuts when the departing figure starts walking to the exit, so the overview shows the whole departure.

A shot never starts before the previous event's own beat has finished (attack beat and collapse, staging
gesture), nor after its own timestamp. Cuts are resolved once per scenario (`ShotPlan`); a frame only looks up
where the current time falls. Real projected cases cut 2–4 times in total. Seeking and playback speed cannot
change the shot at a given time.

### Measurements

Measured by projection (`Camera.WorldToViewportPoint`, 16:10 viewer aspect), never from screenshots:
`Tools/CASELINE/Report Reconstruction Camera Matrix (U5.5 action cameras)` writes the full report, and the
`(U5.4 baseline)` item writes the same report for the frozen U5.4 camera. At the attack beat:

| | U5.4 camera | U5.5 `PhysicalAttack` |
| --- | --- | --- |
| attacker height on screen | 21.0–27.1% | 30.5% |
| victim height on screen | 19.9–25.2% | 33.4% |
| both people together | 21.5–28.0% | 34.3% |
| floor width in frame | 10.6–13.7 m | 8.7 m |

The matrix covers 7 methods × 5 environments × 3 role variants (third person present, accomplice or unnamed
discoverer) at 9 beats, 945 samples, plus 63 samples on the 8 real projected fixtures. At every active beat,
everyone relevant must be fully in frame (head, feet, shoulders, arm reach, or a lying body's full length), in
front of the camera, unoccluded by scenery, with the role label on screen and the two people's silhouettes apart.

### Visual QA tooling

- `Tools/CASELINE/Render Reconstruction Camera QA Stills` renders contact sheets (U5.4 vs U5.5) of the real
  projected fixtures and every environment at exact beat times, with real poses. Run it in batch mode without
  `-nographics`; output goes to `CASELINE_REPORT_DIR`, never into the project.
- The reconstruction prototype scene's dev HUD has a scenario switcher (real projected method fixtures and one
  synthetic scene per environment) and attack/staging jump buttons. The player-facing embed never draws it.

## Environments

Five minimal kinds (`corridor`, `parking`, `shop`, `street`, `generic`): floor, walls, slot markers and at most
two cosmetic props. Scenery yields to semantic slots, never the reverse: the U5.5 audit moved the parking pillars
from the foreground to the back row, where they can no longer hide a person at the talk or stand beside the lens.

## Tests and build

- Unity EditMode (`-runTests -testPlatform EditMode`): CCTV and reconstruction suites, including the animator
  asset guard, framing guard, camera director/controller tests and the camera matrix.
- TypeScript (Vitest): projector, presentation pacing, 2,000-case method coverage diagnostics, player/viewer tests.
- Release build: `Tools/CASELINE/Build Shared Embed Scene (CCTV + Reconstruction)`, then
  `Tools/CASELINE/Build Shared Embed WebGL (Brotli)`, then copy `SharedEmbedBrotli/Build/*` to
  `public/unity/cctv/Build/`. Rebuilding scenes rewrites the CCTV actor assets, `CCTVEmbed.unity` and
  `Reconstruction_Actor.controller` with regenerated ids and the same content; those changes are not committed.

## Known limitations

- Actors are staged side by side at fixed lateral offsets, all facing +z; a beat shows the kind of act, never the
  exact geometry between the people.
- The street environment's cosmetic building can sit behind the talk shot, which lowers contrast slightly.
- A Cameras → report navigation restarts the Unity runtime (about 5–8 s), because the host page unmounts.
- The reconstruction is desktop only by design; mobile shows the written reconstruction.
