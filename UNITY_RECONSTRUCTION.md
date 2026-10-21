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
  "Reconstitution visuelle - positions et apparences indicatives" ("apparences" because, when the optional character
  kit below is installed, the people are textured models whose sex and outfit are a fixed table choice, not a likeness).
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

## Optional office art kit (Synty POLYGON Office)

The corridor environment (the kind used for offices, police stations, hospitals, hotels, train stations and
warehouses) can be dressed with real models: kit doors and ceiling light panels replace the box doors, door frames and
panels, and a coat rack, two plants, a bin, a water cooler and an exit sign stand against the far wall.

The art is licensed third-party content and this repository is public, so it is **never committed**:

- the pack lives in `unity/CaselineVisualPrototype/Assets/ThirdParty/PolygonOffice` and the curated kit in
  `Assets/Resources/OfficeKit`, both gitignored;
- `Tools/CASELINE/Build Office Kit (Synty POLYGON Office)` (`OfficeKitBuilder`) rewrites the pack's URP Shader Graph
  materials onto the Built-in Standard shader (they render magenta otherwise) and copies the listed pieces into
  `Resources/OfficeKit` without colliders, lights or scripts (WebGL strips the Physics module). Everything under
  `Resources` ships, so the list in `OfficeKitBuilder.Kit` is kept to what the scenery places;
- without the kit installed (a fresh clone, CI) `ReconstructionOfficeKit.IsAvailable` is false and every environment
  is exactly the box blockout described above. The kit never changes geometry the tests measure: skinned pieces keep
  their bounds in `ReconstructionEnvironmentStructure`, and the furnishings' footprints
  (`ReconstructionOfficeDressing`) are always part of `OccluderBounds`, installed or not;
- furnishings stay on the far-wall strip, clear of the beat (at least 1.6 m from every action slot), the plain wall
  behind it (x -3.2 to 2.0) and every doorway, and are neutral by construction (no document, device, bottle, tool,
  weapon or anything that could read as evidence).

Tests: `ReconstructionOfficeKitTests` (data tests run everywhere; placement tests are skipped when the kit is absent).

### Characters

With the kit installed, the blockout mannequin is replaced by textured Synty office workers
(`ReconstructionActorKit`, `Resources/OfficeKit/Actors`, built by `SyntyActorBuilder` at the end of the same menu item).

- **Choice**: a fixed 4 x 3 table keyed ONLY on `genericAppearance` ("category_tone"): 12 distinct characters, never the
  role, visual id, person, sex or age. No security guard, cleaner or boss outfit, which would say something about who the
  person is. The pack's characters are each male or female, so the figure is not a likeness of the person it stands
  for; that is why the viewer's disclaimer now says "apparences". Unknown appearances fall back to the mannequin.
- **Animation**: two sources, both baked into plain transform-curve clips and a controller per sex (`Synty_Actor_Male`,
  `Synty_Actor_Female`) with the mannequin's state names, so `ReconstructionActorController` plays them unchanged and
  every pose is still a pure function of the time.
  - The neutral beats (strike, strangle, stab, firearm hold, push, neutral interaction) are the mannequin's clips baked
    across: each mapped bone gets the mannequin bone's world-space rotation change applied to its own rest pose, so the
    bones' different local axes do not matter; the arms are first dropped from the model's T-pose; hip height is scaled
    in proportion.
  - Idle, Walk, ManipulateScene (a stand-to-crouch then a crouch) and Collapse (a forward fall) use Synty
    motion-capture clips when those animation packs are installed (`A_Idle_Standing`, `A_Walk_F`, `A_Stand_ToCrouch`,
    `A_Idle_Crouching`, masculine or feminine variant by the character's sex, and `A_Death_F_01_Sword`, which holds no
    weapon pose on its way down). The humanoid clips are sampled on the character's own Avatar, so Unity does the
    retargeting. Without those packs the mannequin bake is kept.
  - Deliberately not used: the packs' emotes and taunts (anger, sadness, celebration would colour the people and the
    truth boundary forbids that), bow and sword attacks (they stage a weapon the reconstruction never models).
  - The animation packs are `.unitypackage` files that also ship sample scripts and editor tools (some need the Input
    System package), so they are never imported whole: only the nine FBX files above are copied, with their `.meta`
    files, into `Assets/ThirdParty/Synty` (gitignored with the rest of the licensed art).
- **Look**: scaled to the mannequin's 1.78 m (what every framing measurement assumes) and lifted so the shoe soles sit
  on the floor; one copy of the atlas material per actor type with a gentle emission of its own albedo, because the
  scene's dim ambient light left the dark outfits nearly black; no tone tint (`ReconstructionKitActor` marks them).
- **Size**: measured `data.br`: 0.94 MB without any kit, 1.61 MB with the scenery kit, 2.60 MB with scenery and
  characters on the mannequin-baked clips, 2.96 MB with the motion-capture clips too; the wasm is unchanged.

Tests: `ReconstructionActorKitTests`. `Tools/CASELINE/Render Synty Actor QA Stills` renders every beat of a corridor
and a generic scenario with real appearances (it freezes each skinned mesh first: outside play mode `Camera.Render`
does not refresh skinning).

### In the surveillance cameras

The CCTV view uses the same kit (`CCTVOfficeKit`, `CCTVActorKit`, `CCTVOfficeDressing`; the two Unity assemblies do not
reference each other, so the few lines of loading and fitting are repeated):

- **Corridor scenery**: a kit door replaces the box doorway, kit ceiling light panels replace the three light strips,
  and a coat rack, two plants, a bin and a water cooler stand along the far wall, away from the walking lines
  (z = 0, 3, 6) and the doorway. Every other environment kind and every other box is untouched.
- **The person**: the scene has one actor slot, pre-built as a mannequin in the committed scene. At runtime
  `CCTVSceneController.ApplyScenario` asks `CCTVActorKit` for a kit actor; `CCTVActorController.UseKitActor` hides the
  mannequin's renderers and drives the kit actor's Animator (same `Idle` and `Walk` state names, same frozen clock and
  10 fps cadence), and `UseKitActor(null)` brings the mannequin back. The committed scene files are not touched.
- **Which character**: keyed ONLY on the camera id (a stable FNV-1a hash into the twelve office workers), not on the
  actor. A camera therefore always shows the same kind of person and different cameras show different ones, but
  nothing about who is on screen can change it. Keying it on the actor's visual id would let a player recognise one
  anonymous figure across clips by their clothes, which the generic mannequin never allowed; that would be a gameplay
  change, not a visual one.

Tests: `CCTVOfficeKitTests`. `Tools/CASELINE/Render CCTV Kit QA Stills` renders a walking actor through the real
corridor and generic camera presets.

Not done: the other CCTV environment kinds (parking, shop, street, generic) and the other four reconstruction ones.

Shipping note: a WebGL build embeds the pieces it uses. Publishing that build to `public/unity/cctv/Build` puts the
used art in a public repository, which the licence may not allow; check it before copying a kit build there.

## Known limitations

- Actors are staged side by side at fixed lateral offsets, all facing +z; a beat shows the kind of act, never the
  exact geometry between the people.
- The street environment's cosmetic building can sit behind the talk shot, which lowers contrast slightly.
- A Cameras → report navigation restarts the Unity runtime (about 5–8 s), because the host page unmounts.
- The reconstruction is desktop only by design; mobile shows the written reconstruction.
