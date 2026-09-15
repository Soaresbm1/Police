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

            BuildLighting();

            var floorMat = MakeMaterial("Reconstruction_Floor", new Color(0.22f, 0.22f, 0.24f));
            var wallMat = MakeMaterial("Reconstruction_Wall", new Color(0.32f, 0.30f, 0.28f));
            var propMat = MakeMaterial("Reconstruction_Prop", new Color(0.26f, 0.24f, 0.22f));
            var zoneMat = MakeMaterial("Reconstruction_ZoneMarker", new Color(0.75f, 0.6f, 0.2f, 0.5f));

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

            EditorSceneManager.MarkSceneDirty(scene);
            EditorSceneManager.SaveScene(scene, ScenePath);
            Debug.Log($"[Reconstruction] Prototype scene built and saved to {ScenePath}");
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
            var files = new[]
            {
                "reconstruction-poc-real.json",
                "reconstruction-qa-corridor.json",
                "reconstruction-qa-parking.json",
                "reconstruction-qa-shop.json",
                "reconstruction-qa-street.json",
                "reconstruction-qa-generic.json",
            };
            var labels = new[] { "A: CAS REEL", "B: CORRIDOR", "C: PARKING", "D: SHOP", "E: STREET", "F: GENERIC" };
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
            var (idle, walk, attackStrike, attackStrangle, collapse) = BuildAnimationClips();
            animator.runtimeAnimatorController = BuildAnimatorController(idle, walk, attackStrike, attackStrangle, collapse);

            actor.AddComponent<ReconstructionActorController>().SetAnimator(animator);
            return actor;
        }

        private static (Camera overview, Camera close) BuildCameras()
        {
            // Framing derived the same way U4's CCTV camera work validated:
            // occupancy ~= actorHeight / (2*distance*tan(FOV/2)), with
            // actorHeight=1.78m (matches CCTVFramingMeasurement's own
            // constant). Overview targets ~13% (within the 12-25% band),
            // close targets ~29% (within the 20-35% band), both measured by
            // ReconstructionFramingReport (added in U5.2.1).
            var overviewGo = new GameObject("OverviewCamera");
            var overview = overviewGo.AddComponent<Camera>();
            // Phase U5.2.1 — U4.3's own measurement tooling found the
            // original (0,9,-13)/55° overview read at only ~9.2-10.7%
            // actor occupancy across all 5 environments, under the 12-25%
            // target floor. Moved 25% closer along the EXACT SAME viewing
            // ray toward the same ground-plane aim point (~(0,0,-0.13)) —
            // a pure dolly, so rotation is mathematically unchanged (see
            // U4.3's own CCTV camera work for why scaling a position along
            // a ray to a fixed target preserves direction) — verified
            // empirically afterward with ReconstructionFramingReport, not
            // assumed from the formula alone: raised the whole band to
            // ~12.3-14.3%, comfortably inside target with FOV untouched.
            overview.transform.position = new Vector3(0f, 6.75f, -9.78f);
            overview.transform.rotation = Quaternion.LookRotation(new Vector3(0f, -0.7f, 1f).normalized, Vector3.up);
            overview.fieldOfView = 55f;
            overview.nearClipPlane = 0.1f;
            overview.farClipPlane = 100f;

            var closeGo = new GameObject("CloseCamera");
            var close = closeGo.AddComponent<Camera>();
            close.transform.position = new Vector3(0f, 2.5f, -6.5f);
            close.transform.rotation = Quaternion.LookRotation(new Vector3(0f, -0.25f, 1f).normalized, Vector3.up);
            close.fieldOfView = 50f;
            close.nearClipPlane = 0.1f;
            close.farClipPlane = 100f;
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
            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Flat;
            RenderSettings.ambientLight = new Color(0.2f, 0.2f, 0.22f);
        }

        private static (AnimationClip idle, AnimationClip walk, AnimationClip attackStrike, AnimationClip attackStrangle, AnimationClip collapse) BuildAnimationClips()
        {
            var idle = new AnimationClip { legacy = false, name = "Idle" };
            idle.SetCurve("Hips", typeof(Transform), "localPosition.y", AnimationCurve.Constant(0, 1, HipsStandingHeight));
            idle.SetCurve("Hips/Spine/Chest/LeftUpperArm", typeof(Transform), "localEulerAngles.x", AnimationCurve.Constant(0, 1, 4f));
            idle.SetCurve("Hips/Spine/Chest/RightUpperArm", typeof(Transform), "localEulerAngles.x", AnimationCurve.Constant(0, 1, 4f));

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
            foreach (var clip in new[] { idle, walk, attackStrike, attackStrangle, collapse })
            {
                AssetDatabase.CreateAsset(clip, $"{AnimFolder}/Reconstruction_{clip.name}.anim");
            }
            AssetDatabase.SaveAssets();

            return (idle, walk, attackStrike, attackStrangle, collapse);
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

        private static AnimatorController BuildAnimatorController(AnimationClip idle, AnimationClip walk, AnimationClip attackStrike, AnimationClip attackStrangle, AnimationClip collapse)
        {
            var controller = AnimatorController.CreateAnimatorControllerAtPath($"{AnimFolder}/Reconstruction_Actor.controller");
            var stateMachine = controller.layers[0].stateMachine;

            var idleState = stateMachine.AddState("Idle");
            idleState.motion = idle;
            idleState.writeDefaultValues = true;

            var walkState = stateMachine.AddState("Walk");
            walkState.motion = walk;
            walkState.writeDefaultValues = true;

            var strikeState = stateMachine.AddState("AttackStrike");
            strikeState.motion = attackStrike;
            strikeState.writeDefaultValues = true;

            var strangleState = stateMachine.AddState("AttackStrangle");
            strangleState.motion = attackStrangle;
            strangleState.writeDefaultValues = true;

            var collapseState = stateMachine.AddState("Collapse");
            collapseState.motion = collapse;
            collapseState.writeDefaultValues = true;

            stateMachine.defaultState = idleState;
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
