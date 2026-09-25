using System.IO;
using Caseline.CCTVEditor;
using Caseline.Reconstruction;
using UnityEditor;
using UnityEditor.Animations;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Caseline.ReconstructionEditor
{
    /// <summary>
    /// Phase U5.2 — deterministically (re)generates the standalone
    /// `ReconstructionPrototype.unity` scene from code, mirroring
    /// `CCTVPrototypeBuilder`'s own "always reproducible from source
    /// control alone" discipline WITHOUT modifying that file — the one
    /// reuse this class takes from CCTV is calling its already-public
    /// `BuildActor()` for the shared humanoid skeleton/visuals (req. 8: the
    /// validated U4 rig), then replacing its Animator controller and
    /// controller component with this subsystem's own — everything else
    /// here (environment, cameras, playback, overlay, animation clips) is
    /// entirely separate code.
    /// </summary>
    public static class ReconstructionSceneBuilder
    {
        private const string ScenePath = "Assets/Scenes/ReconstructionPrototype.unity";
        private const string AnimFolder = "Assets/Animations/Reconstruction";

        // Matches CCTVPrototypeBuilder.BuildActor()'s own private HipsHeight
        // constant — a known geometric fact about the rig that method
        // builds, duplicated here (not imported) since this class must stay
        // fully independent of CCTV's internals per this phase's "keep
        // separate" instruction. If that rig's proportions ever change,
        // this constant would need updating to match — documented so a
        // future reader knows why the two numbers must agree.
        private const float HipsStandingHeight = 0.92f;

        [MenuItem("Tools/CASELINE/Build Reconstruction Prototype Scene")]
        public static void BuildScene()
        {
            EnsureFolder("Assets/Scenes");
            EnsureFolder("Assets/Animations");
            EnsureFolder(AnimFolder);

            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Flat;
            RenderSettings.ambientLight = AmbientLight;

            PopulateReconstruction(developerHud: true);

            EditorSceneManager.MarkSceneDirty(scene);
            EditorSceneManager.SaveScene(scene, ScenePath);
            Debug.Log($"[Reconstruction] Prototype scene built and saved to {ScenePath}");
        }

        public static readonly Color AmbientLight = new(0.2f, 0.2f, 0.22f);

        /// <summary>Builds every reconstruction object (light, environment, actor template, cameras, controllers,
        /// overlay) at the root of the currently open scene. The shared embed scene reparents them under its
        /// reconstruction root.</summary>
        public static (ReconstructionSceneController scene, ReconstructionPlaybackController playback, ReconstructionOverlay overlay) PopulateReconstruction(bool developerHud)
        {
            BuildLighting();

            var floorMat = MakeMaterial("Reconstruction_Floor", ReconstructionEnvironmentPalette.Floor);
            var wallMat = MakeMaterial("Reconstruction_Wall", ReconstructionEnvironmentPalette.Wall);
            var propMat = MakeMaterial("Reconstruction_Prop", ReconstructionEnvironmentPalette.Prop);
            var zoneMat = MakeMaterial("Reconstruction_ZoneMarker", ReconstructionEnvironmentPalette.ZoneMarker);

            var environmentGo = new GameObject("Environment");
            var environmentController = environmentGo.AddComponent<ReconstructionEnvironmentController>();

            var actorsRoot = new GameObject("Actors");

            var actorTemplate = BuildActorTemplate();
            actorTemplate.SetActive(false); // template only — never rendered itself

            var (overviewCam, closeCam) = BuildCameras();
            var cameraRigGo = new GameObject("ReconstructionCameraRig");
            var cameraController = cameraRigGo.AddComponent<ReconstructionCameraController>();
            cameraController.Configure(overviewCam, closeCam);

            var sceneControllerGo = new GameObject("ReconstructionSceneController");
            var sceneController = sceneControllerGo.AddComponent<ReconstructionSceneController>();
            sceneController.Configure(actorsRoot.transform, environmentController, cameraController, actorTemplate, floorMat, wallMat, propMat, zoneMat);
            sceneController.SetCamerasForLabels(overviewCam, closeCam);

            var playbackGo = new GameObject("ReconstructionPlaybackController");
            var playbackController = playbackGo.AddComponent<ReconstructionPlaybackController>();
            playbackController.Configure(sceneController);
            sceneController.SetPlaybackForFileLoads(playbackController);

            var overlayGo = new GameObject("ReconstructionOverlay");
            var overlay = overlayGo.AddComponent<ReconstructionOverlay>();
            SetPrivateField(overlay, "playback", playbackController);
            overlay.SetScene(sceneController);
            overlay.SetDeveloperHud(developerHud);

            return (sceneController, playbackController, overlay);
        }

        /// <summary>Dev/Editor-only QA scenario switcher (req. 24): A is the
        /// one real, projector-exported CASELINE case; B-F are hand-crafted
        /// synthetic fixtures, one per environment kind, clearly separate
        /// from the real case and never gameplay-reachable. Never wired
        /// onto a production embed scene — there is no production embed
        /// scene for Reconstruction yet (U5.3, not this phase).</summary>
        [MenuItem("Tools/CASELINE/Wire Reconstruction QA Switcher")]
        public static void WireQaSwitcher()
        {
            var scene = EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
            var overlay = Object.FindFirstObjectByType<ReconstructionOverlay>();
            var sceneController = Object.FindFirstObjectByType<ReconstructionSceneController>();
            var playbackController = Object.FindFirstObjectByType<ReconstructionPlaybackController>();
            if (overlay == null || sceneController == null || playbackController == null)
            {
                Debug.LogError("[Reconstruction] WireQaSwitcher: scene is missing required components — run Build Reconstruction Prototype Scene first.");
                return;
            }
            // The method fixtures are REAL PROJECTED cases (one generated case per CrimeMethod, exported by
            // lib/game-engine/reconstruction/__tests__/export-method-fixtures.ts); the environment fixtures are
            // synthetic QA scenes. Dev-scene only — the player-facing embed never reads StreamingAssets.
            var files = new[]
            {
                "reconstruction-poc-real.json",
                "reconstruction-method-blunt-force.json",
                "reconstruction-method-stabbing.json",
                "reconstruction-method-strangulation.json",
                "reconstruction-method-firearm.json",
                "reconstruction-method-fall-push.json",
                "reconstruction-method-poisoning.json",
                "reconstruction-method-staged-overdose.json",
                "reconstruction-qa-corridor.json",
                "reconstruction-qa-parking.json",
                "reconstruction-qa-shop.json",
                "reconstruction-qa-street.json",
                "reconstruction-qa-generic.json",
            };
            var labels = new[]
            {
                "A: CAS REEL",
                "1: COUPS",
                "2: ARME BLANCHE",
                "3: STRANGULATION",
                "4: ARME A FEU",
                "5: POUSSEE",
                "6: SUBSTANCE",
                "7: SURDOSE",
                "B: CORRIDOR",
                "C: PARKING",
                "D: SHOP",
                "E: STREET",
                "F: GENERIC",
            };
            overlay.SetScenarioSwitcher(sceneController, playbackController, files, labels);
            EditorSceneManager.MarkSceneDirty(scene);
            EditorSceneManager.SaveScene(scene, ScenePath);
            Debug.Log("[Reconstruction] QA switcher wired and scene saved.");
        }

        /// <summary>Local-only WebGL build for standalone QA (req. 27) —
        /// output stays under a gitignored directory, NEVER copied to
        /// `public/unity/`. Uncompressed dev build, same convention
        /// `CCTVPrototypeBuilder.BuildWebGL()` uses for its own dev
        /// output.</summary>
        [MenuItem("Tools/CASELINE/Build Reconstruction WebGL (Local QA)")]
        public static void BuildWebGLLocal()
        {
            var outputPath = "ReconstructionWebBuild";
            // Uncompressed — same reason CCTVPrototypeBuilder.BuildWebGL()
            // disables compression for its own local dev build: a plain
            // `python -m http.server` doesn't set the Content-Encoding
            // header a compressed build needs, so local QA needs
            // uncompressed output regardless of what a real deployment
            // would eventually use.
            var previousCompression = PlayerSettings.WebGL.compressionFormat;
            var previousDevelopment = EditorUserBuildSettings.development;
            PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Disabled;
            EditorUserBuildSettings.development = true;
            try
            {
                var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions
                {
                    scenes = new[] { ScenePath },
                    locationPathName = outputPath,
                    target = BuildTarget.WebGL,
                    options = BuildOptions.Development,
                });
                Debug.Log($"[Reconstruction] WebGL build result: {report.summary.result}, size={report.summary.totalSize} bytes, errors={report.summary.totalErrors}");
            }
            finally
            {
                PlayerSettings.WebGL.compressionFormat = previousCompression;
                EditorUserBuildSettings.development = previousDevelopment;
            }
        }

        private static GameObject BuildActorTemplate()
        {
            var actor = CCTVPrototypeBuilder.BuildActor();
            actor.name = "ReconstructionActorTemplate";

            var cctvController = actor.GetComponent<Caseline.CCTV.CCTVActorController>();
            if (cctvController != null) Object.DestroyImmediate(cctvController);

            var animator = actor.GetComponent<Animator>();
            animator.runtimeAnimatorController = BuildAnimatorController(BuildAnimationClips());

            actor.AddComponent<ReconstructionActorController>().SetAnimator(animator);

            // U5.6 iteration 2 — Reconstruction-only silhouette polish, applied AFTER CCTVPrototypeBuilder.BuildActor()
            // returns its own freshly-instantiated GameObject tree (never CCTV's own scene/asset — see that method's
            // own doc comment: this call always constructs a brand-new hierarchy). Every addition below is a NEW
            // child GameObject parented under an EXISTING bone Transform CCTV already created; no bone is renamed,
            // reparented, or removed, so every Animator curve path (which only ever addresses a bone's own
            // localPosition/localRotation, never a child's) stays valid untouched. See
            // ReconstructionActorVisualPolishTests for the structural proof this never touches CCTVPrototypeBuilder,
            // a CCTV scene, or a shared animation asset.
            ReconstructionActorVisualPolish.Apply(actor);

            return actor;
        }

        private static (Camera overview, Camera close) BuildCameras()
        {
            var overview = new GameObject("OverviewCamera").AddComponent<Camera>();
            ReconstructionCameraController.ApplyOverviewSpec(overview);

            // The action camera: ReconstructionCameraController places it at the selected preset on every cut.
            var close = new GameObject("CloseCamera").AddComponent<Camera>();
            ReconstructionCameraController.ApplyShot(close, ReconstructionCameraPresets.Shot("generic", ReconstructionCameraMode.PhysicalAttack, "crime_point"));
            close.gameObject.SetActive(false); // overview is the default; ReconstructionCameraController switches deterministically

            return (overview, close);
        }

        private static void BuildLighting()
        {
            var lightGo = new GameObject("Directional Light");
            var light = lightGo.AddComponent<Light>();
            light.type = LightType.Directional;
            light.intensity = 1.1f;
            light.color = new Color(0.98f, 0.96f, 0.9f);
            lightGo.transform.rotation = Quaternion.Euler(55f, -30f, 0f);
        }

        private const string RightUpperArm = "Hips/Spine/Chest/RightUpperArm";
        private const string LeftUpperArm = "Hips/Spine/Chest/LeftUpperArm";
        private const string RightLowerArm = "Hips/Spine/Chest/RightUpperArm/RightLowerArm";
        private const string LeftLowerArm = "Hips/Spine/Chest/LeftUpperArm/LeftLowerArm";
        private const string Chest = "Hips/Spine/Chest";

        private static System.Collections.Generic.List<(string state, AnimationClip clip)> BuildAnimationClips()
        {
            var idle = new AnimationClip { legacy = false, name = "Idle" };
            idle.SetCurve("Hips", typeof(Transform), "localPosition.y", AnimationCurve.Constant(0, 1, HipsStandingHeight));
            idle.SetCurve("Hips/Spine/Chest/LeftUpperArm", typeof(Transform), "localEulerAngles.x", AnimationCurve.Constant(0, 1, 4f));
            idle.SetCurve("Hips/Spine/Chest/RightUpperArm", typeof(Transform), "localEulerAngles.x", AnimationCurve.Constant(0, 1, 4f));
            // U5.6 iteration 3 — deferred Idle audit found the original pose had a straight-arm, straight-leg
            // "wooden soldier" stance (only the two curves above existed: a 4-degree shoulder lean, nothing at the
            // elbow or knee), a likely contributor to the block/mannequin impression at gameplay camera distance.
            // Fixed-constant curves (never a random/procedural offset) for a small, deterministic elbow-bend and
            // knee-soften — the same absolute time still always reproduces the exact same pose.
            idle.SetCurve(LeftLowerArm, typeof(Transform), "localEulerAngles.x", AnimationCurve.Constant(0, 1, 8f));
            idle.SetCurve(RightLowerArm, typeof(Transform), "localEulerAngles.x", AnimationCurve.Constant(0, 1, 8f));
            idle.SetCurve("Hips/LeftUpperLeg/LeftLowerLeg", typeof(Transform), "localEulerAngles.x", AnimationCurve.Constant(0, 1, 3f));
            idle.SetCurve("Hips/RightUpperLeg/RightLowerLeg", typeof(Transform), "localEulerAngles.x", AnimationCurve.Constant(0, 1, 3f));

            var walk = new AnimationClip { legacy = false, name = "Walk", wrapMode = WrapMode.Loop };
            var walkSettings = AnimationUtility.GetAnimationClipSettings(walk);
            walkSettings.loopTime = true;
            AnimationUtility.SetAnimationClipSettings(walk, walkSettings);
            walk.SetCurve("Hips", typeof(Transform), "localPosition.y", AnimationCurve.Constant(0, 1, HipsStandingHeight));
            walk.SetCurve("Hips/LeftUpperLeg", typeof(Transform), "localEulerAngles.x", SineCurve(22f, 0f));
            walk.SetCurve("Hips/RightUpperLeg", typeof(Transform), "localEulerAngles.x", SineCurve(22f, Mathf.PI));
            walk.SetCurve("Hips/Spine/Chest/LeftUpperArm", typeof(Transform), "localEulerAngles.x", SineCurve(16f, Mathf.PI));
            walk.SetCurve("Hips/Spine/Chest/RightUpperArm", typeof(Transform), "localEulerAngles.x", SineCurve(16f, 0f));

            var attackStrike = new AnimationClip { legacy = false, name = "AttackStrike" };
            // A single forward-and-back arm swing — one beat, no repeats,
            // no fabricated multi-strike choreography (req. 12).
            attackStrike.SetCurve("Hips/Spine/Chest/RightUpperArm", typeof(Transform), "localEulerAngles.x", BeatCurve(0f, -75f, 4f));
            attackStrike.SetCurve("Hips/Spine/Chest", typeof(Transform), "localEulerAngles.x", BeatCurve(0f, 8f, 4f));

            var attackStrangle = new AnimationClip { legacy = false, name = "AttackStrangle" };
            // A held close-range contact pose — both arms raised and held,
            // no struggle animation, no extra cycles (req. 12).
            attackStrangle.SetCurve("Hips/Spine/Chest/LeftUpperArm", typeof(Transform), "localEulerAngles.x", HoldCurve(4f, -95f));
            attackStrangle.SetCurve("Hips/Spine/Chest/RightUpperArm", typeof(Transform), "localEulerAngles.x", HoldCurve(4f, -95f));

            // U5.4 §13 — a short forward thrust of the striking arm, elbow straightening. One beat, no weapon
            // model, no wound, no repeat: it says "a thrusting attack", never where or with what.
            var attackStab = new AnimationClip { legacy = false, name = "AttackStab" };
            attackStab.SetCurve(RightUpperArm, typeof(Transform), "localEulerAngles.x", BeatCurve(0f, -58f, 6f));
            attackStab.SetCurve(RightLowerArm, typeof(Transform), "localEulerAngles.x", BeatCurve(0f, -30f, 6f));
            attackStab.SetCurve(Chest, typeof(Transform), "localEulerAngles.x", BeatCurve(0f, 14f, 6f));

            // U5.4 §14 — both arms raised and held toward the victim, elbows straight. No projectile, no muzzle
            // flash, no casing, no firearm model: the pose alone carries "a shot was fired at range".
            var attackFirearm = new AnimationClip { legacy = false, name = "AttackFirearm" };
            attackFirearm.SetCurve(RightUpperArm, typeof(Transform), "localEulerAngles.x", HoldCurve(4f, -88f));
            attackFirearm.SetCurve(LeftUpperArm, typeof(Transform), "localEulerAngles.x", HoldCurve(4f, -80f));
            attackFirearm.SetCurve(RightLowerArm, typeof(Transform), "localEulerAngles.x", HoldCurve(0f, 6f));
            attackFirearm.SetCurve(LeftLowerArm, typeof(Transform), "localEulerAngles.x", HoldCurve(0f, 10f));

            // U5.4 §15 — both arms extended in one shove. The victim's existing collapse follows; nothing here
            // implies a staircase, balcony, window or any drop CaseTruth does not record.
            var attackPush = new AnimationClip { legacy = false, name = "AttackPush" };
            attackPush.SetCurve(RightUpperArm, typeof(Transform), "localEulerAngles.x", BeatCurve(0f, -72f, 5f));
            attackPush.SetCurve(LeftUpperArm, typeof(Transform), "localEulerAngles.x", BeatCurve(0f, -72f, 5f));
            attackPush.SetCurve(Chest, typeof(Transform), "localEulerAngles.x", BeatCurve(0f, 10f, 5f));

            // U5.4 §16/§17 — the neutral interaction used for poisoning and staged overdose alike: one hand
            // extended toward the victim and held. CaseTruth has no structured field for the delivery (drink,
            // food, injection), so nothing is held, offered or injected; the written reconstruction carries the
            // detail the animation must not claim. Also the fallback for any action this build does not know.
            var neutralInteraction = new AnimationClip { legacy = false, name = "NeutralInteraction" };
            neutralInteraction.SetCurve(RightUpperArm, typeof(Transform), "localEulerAngles.x", HoldCurve(4f, -52f));
            neutralInteraction.SetCurve(RightLowerArm, typeof(Transform), "localEulerAngles.x", HoldCurve(0f, -18f));

            // U5.4 §18 — a generic "handling something at the scene" crouch for stage_scene. No burglary,
            // suicide or accident is acted out: CaseTruth's staging description stays in text.
            var manipulateScene = new AnimationClip { legacy = false, name = "ManipulateScene" };
            manipulateScene.SetCurve("Hips", typeof(Transform), "localPosition.y", HoldCurve(HipsStandingHeight, 0.68f));
            manipulateScene.SetCurve(Chest, typeof(Transform), "localEulerAngles.x", HoldCurve(0f, 26f));
            manipulateScene.SetCurve(RightUpperArm, typeof(Transform), "localEulerAngles.x", HoldCurve(4f, -38f));

            var collapse = new AnimationClip { legacy = false, name = "Collapse" };
            // Controlled, deterministic fall to a lying pose — no ragdoll
            // randomness, no wound/blood simulation (req. 13).
            collapse.SetCurve("Hips", typeof(Transform), "localPosition.y", HoldCurve(HipsStandingHeight, 0.22f));
            collapse.SetCurve("Hips", typeof(Transform), "localEulerAngles.x", HoldCurve(0f, 82f));

            // Persist every clip as an asset. Without this the clips exist
            // only for the lifetime of the building Editor session, the
            // controller's states serialize with m_Motion: {fileID: 0}, and
            // the built player animates nothing at all — actors hold the
            // rig's static bind pose, which happens to resemble Idle, so the
            // attack beat and the victim's collapse never render. Found by
            // U5.2.1's visual QA; the EditMode tests could not see it
            // because they assert which state the timeline selects, never
            // that the state carries a motion.
            var clips = new System.Collections.Generic.List<(string state, AnimationClip clip)>
            {
                ("Idle", idle),
                ("Walk", walk),
                ("AttackStrike", attackStrike),
                ("AttackStrangle", attackStrangle),
                ("AttackStab", attackStab),
                ("AttackFirearm", attackFirearm),
                ("AttackPush", attackPush),
                ("NeutralInteraction", neutralInteraction),
                ("ManipulateScene", manipulateScene),
                ("Collapse", collapse),
            };
            // CreateAsset renames the object to the file name, so the animator state name is carried separately.
            foreach (var (state, clip) in clips)
            {
                AssetDatabase.CreateAsset(clip, $"{AnimFolder}/Reconstruction_{state}.anim");
            }
            AssetDatabase.SaveAssets();

            return clips;
        }

        private static AnimationCurve SineCurve(float amplitudeDeg, float phase)
        {
            var curve = new AnimationCurve();
            const int samples = 8;
            for (var i = 0; i <= samples; i++)
            {
                var t = i / (float)samples;
                var angle = t * Mathf.PI * 2f + phase;
                curve.AddKey(new Keyframe(t, Mathf.Sin(angle) * amplitudeDeg));
            }
            for (var i = 0; i <= samples; i++) curve.SmoothTangents(i, 0f);
            return curve;
        }

        /// <summary>Rises from `from` to `to` over the clip's first
        /// `1/holdAfterFraction` and holds `to` for the remainder —
        /// deterministic, single-beat, no repeats.</summary>
        private static AnimationCurve BeatCurve(float from, float to, float holdAfterFraction)
        {
            var riseEnd = 1f / holdAfterFraction;
            var curve = new AnimationCurve(
                new Keyframe(0f, from),
                new Keyframe(riseEnd * 0.5f, to),
                new Keyframe(1f, from));
            for (var i = 0; i < curve.length; i++) curve.SmoothTangents(i, 0f);
            return curve;
        }

        /// <summary>Rises from `from` to `to` over the clip's first
        /// `1/reachAfterFraction` of normalized time, then holds `to` for
        /// the remainder.</summary>
        private static AnimationCurve HoldCurve(float from, float to, float reachAfterFraction = 3f)
        {
            var reachAt = 1f / reachAfterFraction;
            var curve = new AnimationCurve(
                new Keyframe(0f, from),
                new Keyframe(reachAt, to),
                new Keyframe(1f, to));
            for (var i = 0; i < curve.length; i++) curve.SmoothTangents(i, 0f);
            return curve;
        }

        /// <summary>One animator state per persisted clip, named after it. Every state carries a real Motion —
        /// see ReconstructionAnimatorAssetTests for why that is a guarded invariant and not a detail.</summary>
        private static AnimatorController BuildAnimatorController(System.Collections.Generic.List<(string state, AnimationClip clip)> clips)
        {
            var controller = AnimatorController.CreateAnimatorControllerAtPath($"{AnimFolder}/Reconstruction_Actor.controller");
            var stateMachine = controller.layers[0].stateMachine;

            foreach (var (stateName, clip) in clips)
            {
                var state = stateMachine.AddState(stateName);
                state.motion = clip;
                state.writeDefaultValues = true;
                if (stateName == "Idle") stateMachine.defaultState = state;
            }

            return controller;
        }

        private static Material MakeMaterial(string name, Color color)
        {
            var shader = Shader.Find("Standard") ?? Shader.Find("Universal Render Pipeline/Lit");
            var mat = new Material(shader) { name = name, color = color };
            if (mat.HasProperty("_Glossiness")) mat.SetFloat("_Glossiness", 0.12f);
            if (mat.HasProperty("_Smoothness")) mat.SetFloat("_Smoothness", 0.12f);
            if (mat.HasProperty("_Metallic")) mat.SetFloat("_Metallic", 0f);
            return mat;
        }

        private static void EnsureFolder(string path)
        {
            if (AssetDatabase.IsValidFolder(path)) return;
            var parent = Path.GetDirectoryName(path)?.Replace('\\', '/');
            var leaf = Path.GetFileName(path);
            if (!string.IsNullOrEmpty(parent) && !AssetDatabase.IsValidFolder(parent)) EnsureFolder(parent);
            AssetDatabase.CreateFolder(parent, leaf);
        }

        private static void SetPrivateField(object target, string fieldName, object value)
        {
            var field = target.GetType().GetField(fieldName, System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);
            field?.SetValue(target, value);
        }
    }
}
