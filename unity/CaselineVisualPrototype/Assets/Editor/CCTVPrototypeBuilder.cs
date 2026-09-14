using System.IO;
using Caseline.CCTV;
using UnityEditor;
using UnityEditor.Animations;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Caseline.CCTVEditor
{
    /// <summary>
    /// Deterministically (re)generates the entire CCTVPrototype scene from
    /// code — materials, geometry, the procedural humanoid rig, its
    /// Idle/Walk animations, and every manager component's wiring (Phase
    /// U1, req. 18). Re-running <c>Tools/CASELINE/Build CCTV Prototype
    /// Scene</c> always reproduces the same scene byte-for-byte given the
    /// same Unity version — nothing here depends on manual Editor clicking,
    /// so the prototype can be recreated from source control alone.
    /// </summary>
    public static class CCTVPrototypeBuilder
    {
        private const string ScenePath = "Assets/Scenes/CCTVPrototype.unity";
        private const string EmbedScenePath = "Assets/Scenes/CCTVEmbed.unity";
        private const string AnimFolder = "Assets/Animations/CCTV";

        [MenuItem("Tools/CASELINE/Build CCTV Prototype Scene")]
        public static void BuildScene()
        {
            BuildCoreScene(ScenePath, autoLoad: true, addWebBridge: false);
            Debug.Log($"[CCTV] Prototype scene built and saved to {ScenePath}");
        }

        /// <summary>Phase U3 — the production embed target: the exact same
        /// environment/camera/actor rig as the dev/QA scene, but with no
        /// StreamingAssets auto-load (no demo footage should ever flash in
        /// the real embedded viewer — see
        /// <see cref="CCTVSceneController.autoLoadFromStreamingAssets"/>)
        /// and a <see cref="CCTVWebBridge"/> named exactly "WebBridge" so
        /// CASELINE's React component can reach it via
        /// <c>unityInstance.SendMessage('WebBridge', 'LoadScenarioJson', json)</c>.
        /// No dev scenario switcher is wired here (req. 8).</summary>
        [MenuItem("Tools/CASELINE/Build CCTV Embed Scene")]
        public static void BuildEmbedScene()
        {
            var sceneController = BuildCoreScene(EmbedScenePath, autoLoad: false, addWebBridge: true);
            Debug.Log($"[CCTV] Embed scene built and saved to {EmbedScenePath} (sceneController={sceneController != null})");
        }

        private static CCTVSceneController BuildCoreScene(string savePath, bool autoLoad, bool addWebBridge)
        {
            EnsureFolder("Assets/Scenes");
            EnsureFolder("Assets/Animations");
            EnsureFolder(AnimFolder);
            BakePrimitiveMeshes();

            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

            BuildLighting();
            var environment = BuildEnvironment();
            var camera = BuildCamera();
            var actor = BuildActor();

            var managers = new GameObject("Managers");
            var playback = managers.AddComponent<CCTVPlaybackController>();
            var sceneController = managers.AddComponent<CCTVSceneController>();
            var overlay = managers.AddComponent<CCTVOverlay>();

            SetPrivateField(sceneController, "playback", playback);
            SetPrivateField(sceneController, "overlay", overlay);
            SetPrivateField(sceneController, "cctvCamera", camera);
            SetPrivateField(sceneController, "environment", environment);
            SetPrivateListField(sceneController, "sceneActors", new[] { actor.GetComponent<CCTVActorController>() });
            SetPrivateBoolField(sceneController, "autoLoadFromStreamingAssets", autoLoad);
            SetPrivateField(overlay, "playback", playback);

            if (addWebBridge)
            {
                var bridgeGo = new GameObject("WebBridge");
                bridgeGo.transform.SetParent(managers.transform);
                var bridge = bridgeGo.AddComponent<CCTVWebBridge>();
                SetPrivateField(bridge, "sceneController", sceneController);
            }

            EditorSceneManager.MarkSceneDirty(scene);
            EditorSceneManager.SaveScene(scene, savePath);
            return sceneController;
        }

        /// <summary>Entry point for the final non-batch CLI launch — opens
        /// the already-built scene and enters Play Mode so the editor is
        /// left running the demo for visual inspection.</summary>
        public static void OpenAndPlay()
        {
            EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
            EditorApplication.isPlaying = true;
        }

        /// <summary>Wires the visual-QA scenario switcher (Phase U2, req.
        /// 22) onto the already-built scene's <see cref="CCTVOverlay"/> —
        /// a fixed, hardcoded list of StreamingAssets filenames exported
        /// from real CASELINE cases, each with a short on-screen label.
        /// Re-saves the scene. Safe to call as its own `-executeMethod`
        /// step after `BuildScene`, or from the menu once the export
        /// helper has produced the JSON files it references.</summary>
        [MenuItem("Tools/CASELINE/Wire Real-Case Scenario Switcher")]
        public static void SetupScenarioSwitcher()
        {
            var scene = EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
            var sceneController = Object.FindFirstObjectByType<CCTVSceneController>();
            var overlay = Object.FindFirstObjectByType<CCTVOverlay>();
            if (sceneController == null || overlay == null)
            {
                Debug.LogError("[CCTV] SetupScenarioSwitcher: scene is missing CCTVSceneController/CCTVOverlay — run Build CCTV Prototype Scene first.");
                return;
            }

            var files = new[] { "cctv-demo.json", "real-identifiable-parking.json", "real-anonymous-corridor.json", "real-identifiable-shop.json" };
            var labels = new[] { "DEMO", "A: IDENTIFIABLE", "B: ANONYME", "C: SHOP" };
            overlay.SetScenarioSwitcher(sceneController, files, labels);

            EditorSceneManager.MarkSceneDirty(scene);
            EditorSceneManager.SaveScene(scene, ScenePath);
            Debug.Log("[CCTV] Scenario switcher wired and scene saved.");
        }

        /// <summary>Development WebGL build of just the CCTVPrototype scene
        /// (Phase U1, req. 17) — output stays local under
        /// <c>unity/CaselineVisualPrototype/WebBuild</c>, never wired into
        /// CASELINE's own Next.js build.</summary>
        [MenuItem("Tools/CASELINE/Build CCTV Prototype WebGL")]
        public static void BuildWebGL()
        {
            var buildDir = Path.Combine(Directory.GetParent(Application.dataPath)!.FullName, "WebBuild");
            Directory.CreateDirectory(buildDir);

            var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions
            {
                scenes = new[] { ScenePath },
                locationPathName = buildDir,
                target = BuildTarget.WebGL,
                options = BuildOptions.Development,
            });

            Debug.Log($"[CCTV] WebGL build result: {report.summary.result}, size={report.summary.totalSize} bytes, errors={report.summary.totalErrors}");
        }

        /// <summary>Production/release WebGL build of the EMBED scene (Phase
        /// U3, req. 4) — no Development flag, no autoconnect profiler, no
        /// deep profiling. Compression is explicitly DISABLED
        /// (<see cref="UnityEditor.WebGL.WebGLCompressionFormat.Disabled"/>):
        /// per this phase's own "correctness first" instruction, an
        /// uncompressed build sidesteps any risk of Vercel/Next.js static
        /// serving not sending the exact `Content-Encoding` header Unity's
        /// loader expects for pre-compressed `.br`/`.gz` files — safe to
        /// revisit as a size optimization once that's independently
        /// confirmed. Output stays local under
        /// <c>unity/CaselineVisualPrototype/WebBuildRelease</c>; nothing
        /// here touches the dev build at <c>WebBuild/</c> or CASELINE's own
        /// `public/` folder — copying the minimum required subset into
        /// `public/unity/cctv/` is a separate, explicit step.</summary>
        [MenuItem("Tools/CASELINE/Build CCTV Embed WebGL (Release)")]
        public static void BuildWebGLRelease()
        {
            var buildDir = Path.Combine(Directory.GetParent(Application.dataPath)!.FullName, "WebBuildRelease");
            Directory.CreateDirectory(buildDir);

            var previousCompression = PlayerSettings.WebGL.compressionFormat;
            var previousDevelopment = EditorUserBuildSettings.development;
            PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Disabled;
            EditorUserBuildSettings.development = false;

            try
            {
                var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions
                {
                    scenes = new[] { EmbedScenePath },
                    locationPathName = buildDir,
                    target = BuildTarget.WebGL,
                    options = BuildOptions.None,
                });

                Debug.Log($"[CCTV] Release WebGL build result: {report.summary.result}, size={report.summary.totalSize} bytes, errors={report.summary.totalErrors}");
            }
            finally
            {
                PlayerSettings.WebGL.compressionFormat = previousCompression;
                EditorUserBuildSettings.development = previousDevelopment;
            }
        }

        /// <summary>Phase U3.5, req. 13 — same as <see cref="BuildWebGLRelease"/>
        /// but with Brotli compression enabled, for a real size/behavior
        /// comparison against the uncompressed build. Separate output
        /// directory (<c>WebBuildBrotli</c>) so neither build overwrites the
        /// other; nothing here touches `public/unity/cctv/` — copying a
        /// chosen candidate there is a separate, explicit step.</summary>
        [MenuItem("Tools/CASELINE/Build CCTV Embed WebGL (Brotli)")]
        public static void BuildWebGLBrotli()
        {
            var buildDir = Path.Combine(Directory.GetParent(Application.dataPath)!.FullName, "WebBuildBrotli");
            Directory.CreateDirectory(buildDir);

            var previousCompression = PlayerSettings.WebGL.compressionFormat;
            var previousDevelopment = EditorUserBuildSettings.development;
            PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Brotli;
            EditorUserBuildSettings.development = false;

            try
            {
                var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions
                {
                    scenes = new[] { EmbedScenePath },
                    locationPathName = buildDir,
                    target = BuildTarget.WebGL,
                    options = BuildOptions.None,
                });

                Debug.Log($"[CCTV] Brotli WebGL build result: {report.summary.result}, size={report.summary.totalSize} bytes, errors={report.summary.totalErrors}");
            }
            finally
            {
                PlayerSettings.WebGL.compressionFormat = previousCompression;
                EditorUserBuildSettings.development = previousDevelopment;
            }
        }

        /// <summary>Phase U3.5, req. 13 — Gzip variant, for comparison
        /// against Brotli. Separate output directory
        /// (<c>WebBuildGzip</c>).</summary>
        [MenuItem("Tools/CASELINE/Build CCTV Embed WebGL (Gzip)")]
        public static void BuildWebGLGzip()
        {
            var buildDir = Path.Combine(Directory.GetParent(Application.dataPath)!.FullName, "WebBuildGzip");
            Directory.CreateDirectory(buildDir);

            var previousCompression = PlayerSettings.WebGL.compressionFormat;
            var previousDevelopment = EditorUserBuildSettings.development;
            PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Gzip;
            EditorUserBuildSettings.development = false;

            try
            {
                var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions
                {
                    scenes = new[] { EmbedScenePath },
                    locationPathName = buildDir,
                    target = BuildTarget.WebGL,
                    options = BuildOptions.None,
                });

                Debug.Log($"[CCTV] Gzip WebGL build result: {report.summary.result}, size={report.summary.totalSize} bytes, errors={report.summary.totalErrors}");
            }
            finally
            {
                PlayerSettings.WebGL.compressionFormat = previousCompression;
                EditorUserBuildSettings.development = previousDevelopment;
            }
        }

        /// <summary>Extracts Unity's built-in Cube/Plane meshes into real
        /// mesh assets under a <c>Resources</c> folder (idempotent — skips
        /// any mesh that already exists). <see cref="CCTVEnvironmentController"/>
        /// loads these at runtime via <c>Resources.Load</c> and builds its
        /// geometry from `MeshFilter`/`MeshRenderer` directly, deliberately
        /// never calling `GameObject.CreatePrimitive` itself — that method's
        /// own internal "also attach a Collider" step is what breaks on
        /// WebGL, where managed-code stripping removes the concrete
        /// Collider subclasses nothing else in this project references,
        /// and `CreatePrimitive` then fails with "Can't add component
        /// because class 'BoxCollider' doesn't exist!" at runtime (found via
        /// this phase's own console-log verification of a real WebGL
        /// build). Resources-folder assets are never stripped, so this
        /// sidesteps the problem entirely rather than fighting the
        /// linker.</summary>
        private static void BakePrimitiveMeshes()
        {
            EnsureFolder("Assets/Resources");
            EnsureFolder("Assets/Resources/CCTVMeshes");
            BakeMeshIfMissing(PrimitiveType.Cube, "Assets/Resources/CCTVMeshes/Cube.asset");
            BakeMeshIfMissing(PrimitiveType.Plane, "Assets/Resources/CCTVMeshes/Plane.asset");
        }

        private static void BakeMeshIfMissing(PrimitiveType type, string assetPath)
        {
            if (AssetDatabase.LoadAssetAtPath<Mesh>(assetPath) != null) return;
            var temp = GameObject.CreatePrimitive(type);
            var mesh = Object.Instantiate(temp.GetComponent<MeshFilter>().sharedMesh);
            Object.DestroyImmediate(temp);
            AssetDatabase.CreateAsset(mesh, assetPath);
        }

        private static void BuildLighting()
        {
            var lightGo = new GameObject("Directional Light");
            var light = lightGo.AddComponent<Light>();
            light.type = LightType.Directional;
            light.intensity = 1.1f;
            light.color = new Color(1f, 0.98f, 0.92f);
            lightGo.transform.rotation = Quaternion.Euler(55f, -35f, 0f);

            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Flat;
            RenderSettings.ambientLight = new Color(0.24f, 0.24f, 0.26f);
        }

        /// <summary>Creates the environment root and gives it its one-time
        /// default "parking" look via <see cref="CCTVEnvironmentController"/>
        /// (Phase U2, req. 6/14) — the same component
        /// <see cref="CCTVSceneController"/> calls again at runtime to
        /// rebuild for whichever `scene` kind the loaded scenario actually
        /// asks for, so there is exactly one place this geometry is
        /// authored.</summary>
        private static CCTVEnvironmentController BuildEnvironment()
        {
            var env = new GameObject("Environment");
            var controller = env.AddComponent<CCTVEnvironmentController>();
            controller.Build("parking");
            return controller;
        }

        private static Camera BuildCamera()
        {
            var go = new GameObject("CCTV Camera");
            go.tag = "MainCamera";
            var cam = go.AddComponent<Camera>();
            cam.fieldOfView = 62f;
            cam.nearClipPlane = 0.1f;
            cam.farClipPlane = 100f;
            // Placeholder pose — CCTVSceneController overwrites this from
            // the loaded JSON at runtime; this default just keeps the
            // Scene view sensible before Play is pressed.
            go.transform.position = new Vector3(-5.5f, 4.2f, -5.5f);
            go.transform.rotation = Quaternion.Euler(28f, 40f, 0f);
            return cam;
        }

        private static GameObject BuildActor()
        {
            var actorsRoot = new GameObject("Actors");
            // Name is cosmetic only — CCTVSceneController assigns JSON actor
            // entries to scene actor slots by POSITION, not by name, since
            // different CASELINE scenarios use whatever `visualId` the real
            // sequence descriptor already had (e.g. "actor-0").
            var root = new GameObject("Actor");
            root.transform.SetParent(actorsRoot.transform);

            var bodyMat = MakeMaterial("CCTV_Actor", new Color(0.08f, 0.08f, 0.08f));

            var hips = CreateBone("Hips", root.transform, new Vector3(0, 0.95f, 0));
            var spine = CreateBone("Spine", hips, new Vector3(0, 0.28f, 0));
            var chest = CreateBone("Chest", spine, new Vector3(0, 0.24f, 0));
            var head = CreateBone("Head", chest, new Vector3(0, 0.26f, 0));
            AddVisual(head, PrimitiveType.Sphere, new Vector3(0.11f, 0f, 0), new Vector3(0.22f, 0.22f, 0.22f), bodyMat);
            AddVisual(chest, PrimitiveType.Cube, new Vector3(0, 0.1f, 0), new Vector3(0.34f, 0.34f, 0.2f), bodyMat);

            BuildArm("Left", chest, new Vector3(-0.2f, 0.12f, 0), bodyMat);
            BuildArm("Right", chest, new Vector3(0.2f, 0.12f, 0), bodyMat);

            BuildLeg("Left", hips, new Vector3(-0.11f, 0f, 0), bodyMat);
            BuildLeg("Right", hips, new Vector3(0.11f, 0f, 0), bodyMat);

            var animator = root.AddComponent<Animator>();
            var (idleClip, walkClip) = BuildAnimationClips();
            var controller = BuildAnimatorController(idleClip, walkClip);
            animator.runtimeAnimatorController = controller;
            animator.applyRootMotion = false;

            var actorController = root.AddComponent<CCTVActorController>();
            SetPrivateField(actorController, "animator", animator);

            return root;
        }

        private static void BuildArm(string side, Transform parent, Vector3 localPos, Material mat)
        {
            var upper = CreateBone($"{side}UpperArm", parent, localPos);
            AddVisual(upper, PrimitiveType.Cube, new Vector3(0, -0.13f, 0), new Vector3(0.09f, 0.26f, 0.09f), mat);
            var lower = CreateBone($"{side}LowerArm", upper, new Vector3(0, -0.26f, 0));
            AddVisual(lower, PrimitiveType.Cube, new Vector3(0, -0.12f, 0), new Vector3(0.08f, 0.24f, 0.08f), mat);
        }

        private static void BuildLeg(string side, Transform parent, Vector3 localPos, Material mat)
        {
            var upper = CreateBone($"{side}UpperLeg", parent, localPos);
            AddVisual(upper, PrimitiveType.Cube, new Vector3(0, -0.2f, 0), new Vector3(0.14f, 0.4f, 0.14f), mat);
            var lower = CreateBone($"{side}LowerLeg", upper, new Vector3(0, -0.4f, 0));
            AddVisual(lower, PrimitiveType.Cube, new Vector3(0, -0.19f, 0), new Vector3(0.12f, 0.38f, 0.12f), mat);
            var foot = CreateBone($"{side}Foot", lower, new Vector3(0, -0.38f, 0));
            AddVisual(foot, PrimitiveType.Cube, new Vector3(0, -0.03f, 0.07f), new Vector3(0.14f, 0.06f, 0.24f), mat);
        }

        private static (AnimationClip idle, AnimationClip walk) BuildAnimationClips()
        {
            var idle = new AnimationClip { legacy = false, name = "Idle" };
            // A neutral standing pose — a single key is enough; the actor
            // simply holds this stance whenever it isn't walking (before
            // startTime, after endTime, or if a path has zero displacement).
            idle.SetCurve("Hips", typeof(Transform), "localPosition.y", AnimationCurve.Constant(0, 1, 0f));
            AssetDatabase.CreateAsset(idle, $"{AnimFolder}/CCTV_Idle.anim");

            var walk = new AnimationClip { legacy = false, name = "Walk", wrapMode = WrapMode.Loop };
            var settings = AnimationUtility.GetAnimationClipSettings(walk);
            settings.loopTime = true;
            AnimationUtility.SetAnimationClipSettings(walk, settings);

            const float legAmplitudeDeg = 26f;
            const float kneeAmplitudeDeg = 34f;
            const float armAmplitudeDeg = 22f;
            const float hipBobMeters = 0.02f;

            // Legs swing in opposite phase; the lower leg "knee" bends only
            // during that leg's back-swing (a cheap standard trick for a
            // believable FK walk without full IK).
            walk.SetCurve("Hips/LeftUpperLeg", typeof(Transform), "localEulerAngles.x", SineCurve(legAmplitudeDeg, 0f));
            walk.SetCurve("Hips/RightUpperLeg", typeof(Transform), "localEulerAngles.x", SineCurve(legAmplitudeDeg, Mathf.PI));
            walk.SetCurve("Hips/LeftUpperLeg/LeftLowerLeg", typeof(Transform), "localEulerAngles.x", KneeCurve(kneeAmplitudeDeg, 0f));
            walk.SetCurve("Hips/RightUpperLeg/RightLowerLeg", typeof(Transform), "localEulerAngles.x", KneeCurve(kneeAmplitudeDeg, Mathf.PI));

            // Arms counter-swing relative to the same-side leg.
            walk.SetCurve("Hips/Spine/Chest/LeftUpperArm", typeof(Transform), "localEulerAngles.x", SineCurve(armAmplitudeDeg, Mathf.PI));
            walk.SetCurve("Hips/Spine/Chest/RightUpperArm", typeof(Transform), "localEulerAngles.x", SineCurve(armAmplitudeDeg, 0f));

            // Subtle vertical bob, twice per stride (two foot-falls per
            // cycle) — cosmetic only.
            walk.SetCurve("Hips", typeof(Transform), "localPosition.y", BobCurve(hipBobMeters, 0.95f));

            AssetDatabase.CreateAsset(walk, $"{AnimFolder}/CCTV_Walk.anim");

            return (idle, walk);
        }

        private static AnimationCurve SineCurve(float amplitudeDeg, float phase, int samples = 12)
        {
            var curve = new AnimationCurve();
            for (var i = 0; i <= samples; i++)
            {
                var t = (float)i / samples;
                var value = amplitudeDeg * Mathf.Sin(2f * Mathf.PI * t + phase);
                curve.AddKey(new Keyframe(t, value));
            }
            return curve;
        }

        private static AnimationCurve KneeCurve(float amplitudeDeg, float phase, int samples = 12)
        {
            var curve = new AnimationCurve();
            for (var i = 0; i <= samples; i++)
            {
                var t = (float)i / samples;
                // Bends forward only on the back-swing half of this leg's
                // own cycle — never a negative (backward) knee bend.
                var raw = -Mathf.Sin(2f * Mathf.PI * t + phase);
                var value = Mathf.Max(0f, raw) * amplitudeDeg;
                curve.AddKey(new Keyframe(t, value));
            }
            return curve;
        }

        private static AnimationCurve BobCurve(float amplitudeMeters, float baseHeight, int samples = 12)
        {
            var curve = new AnimationCurve();
            for (var i = 0; i <= samples; i++)
            {
                var t = (float)i / samples;
                // Twice per cycle — one dip per footfall.
                var value = baseHeight + Mathf.Abs(Mathf.Sin(2f * Mathf.PI * t)) * amplitudeMeters;
                curve.AddKey(new Keyframe(t, value));
            }
            return curve;
        }

        private static AnimatorController BuildAnimatorController(AnimationClip idle, AnimationClip walk)
        {
            var controller = AnimatorController.CreateAnimatorControllerAtPath($"{AnimFolder}/CCTV_Actor.controller");
            var stateMachine = controller.layers[0].stateMachine;
            var idleState = stateMachine.AddState("Idle");
            idleState.motion = idle;
            var walkState = stateMachine.AddState("Walk");
            walkState.motion = walk;
            stateMachine.defaultState = idleState;
            return controller;
        }

        private static Transform CreateBone(string name, Transform parent, Vector3 localPosition)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            go.transform.localPosition = localPosition;
            return go.transform;
        }

        private static void AddVisual(Transform bone, PrimitiveType type, Vector3 localOffset, Vector3 scale, Material mat)
        {
            var visual = CreatePrimitiveNoCollider(type, "Visual", bone);
            visual.transform.localPosition = localOffset;
            visual.transform.localScale = scale;
            visual.GetComponent<MeshRenderer>().sharedMaterial = mat;
        }

        private static GameObject CreatePrimitiveNoCollider(PrimitiveType type, string name, Transform parent)
        {
            var go = GameObject.CreatePrimitive(type);
            go.name = name;
            var collider = go.GetComponent<Collider>();
            if (collider != null) Object.DestroyImmediate(collider);
            go.transform.SetParent(parent, false);
            return go;
        }

        private static Material MakeMaterial(string name, Color color)
        {
            var shader = Shader.Find("Standard") ?? Shader.Find("Universal Render Pipeline/Lit");
            var mat = new Material(shader) { name = name, color = color };
            return mat;
        }

        private static void EnsureFolder(string path)
        {
            if (AssetDatabase.IsValidFolder(path)) return;
            var parent = Path.GetDirectoryName(path)?.Replace('\\', '/');
            var leaf = Path.GetFileName(path);
            if (!string.IsNullOrEmpty(parent) && !AssetDatabase.IsValidFolder(parent)) EnsureFolder(parent);
            AssetDatabase.CreateFolder(string.IsNullOrEmpty(parent) ? "Assets" : parent, leaf);
        }

        private static void SetPrivateField(Object target, string fieldName, Object value)
        {
            var so = new SerializedObject(target);
            var prop = so.FindProperty(fieldName);
            prop.objectReferenceValue = value;
            so.ApplyModifiedPropertiesWithoutUndo();
        }

        private static void SetPrivateBoolField(Object target, string fieldName, bool value)
        {
            var so = new SerializedObject(target);
            var prop = so.FindProperty(fieldName);
            prop.boolValue = value;
            so.ApplyModifiedPropertiesWithoutUndo();
        }

        private static void SetPrivateListField(Object target, string fieldName, CCTVActorController[] values)
        {
            var so = new SerializedObject(target);
            var prop = so.FindProperty(fieldName);
            prop.arraySize = values.Length;
            for (var i = 0; i < values.Length; i++)
            {
                prop.GetArrayElementAtIndex(i).objectReferenceValue = values[i];
            }
            so.ApplyModifiedPropertiesWithoutUndo();
        }
    }
}
