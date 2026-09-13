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
        private const string AnimFolder = "Assets/Animations/CCTV";

        [MenuItem("Tools/CASELINE/Build CCTV Prototype Scene")]
        public static void BuildScene()
        {
            EnsureFolder("Assets/Scenes");
            EnsureFolder("Assets/Animations");
            EnsureFolder(AnimFolder);

            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

            BuildLighting();
            BuildEnvironment();
            var camera = BuildCamera();
            var actor = BuildActor();

            var managers = new GameObject("Managers");
            var playback = managers.AddComponent<CCTVPlaybackController>();
            var sceneController = managers.AddComponent<CCTVSceneController>();
            var overlay = managers.AddComponent<CCTVOverlay>();

            SetPrivateField(sceneController, "playback", playback);
            SetPrivateField(sceneController, "overlay", overlay);
            SetPrivateField(sceneController, "cctvCamera", camera);
            SetPrivateListField(sceneController, "sceneActors", new[] { actor.GetComponent<CCTVActorController>() });
            SetPrivateField(overlay, "playback", playback);

            EditorSceneManager.MarkSceneDirty(scene);
            EditorSceneManager.SaveScene(scene, ScenePath);

            Debug.Log($"[CCTV] Prototype scene built and saved to {ScenePath}");
        }

        /// <summary>Entry point for the final non-batch CLI launch — opens
        /// the already-built scene and enters Play Mode so the editor is
        /// left running the demo for visual inspection.</summary>
        public static void OpenAndPlay()
        {
            EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
            EditorApplication.isPlaying = true;
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

        private static void BuildEnvironment()
        {
            var env = new GameObject("Environment");

            var floorMat = MakeMaterial("CCTV_Concrete", new Color(0.42f, 0.42f, 0.42f));
            var wallMat = MakeMaterial("CCTV_Wall", new Color(0.55f, 0.55f, 0.57f));
            var pillarMat = MakeMaterial("CCTV_Pillar", new Color(0.35f, 0.35f, 0.36f));
            var lineMat = MakeMaterial("CCTV_ParkingLine", new Color(0.85f, 0.78f, 0.35f));

            var floor = CreatePrimitiveNoCollider(PrimitiveType.Plane, "Floor", env.transform);
            floor.transform.localScale = new Vector3(3f, 1f, 3f); // Unity's Plane primitive is 10x10 units
            floor.GetComponent<MeshRenderer>().sharedMaterial = floorMat;

            // Four boundary walls around a ~30x30 garage footprint.
            AddWall(env.transform, wallMat, new Vector3(0, 2.5f, 15f), new Vector3(30f, 5f, 0.5f));
            AddWall(env.transform, wallMat, new Vector3(0, 2.5f, -15f), new Vector3(30f, 5f, 0.5f));
            AddWall(env.transform, wallMat, new Vector3(15f, 2.5f, 0), new Vector3(0.5f, 5f, 30f));
            AddWall(env.transform, wallMat, new Vector3(-15f, 2.5f, 0), new Vector3(0.5f, 5f, 30f));

            // Support pillars — also give the walk path something to read
            // as a real garage rather than an empty box.
            var pillarPositions = new[]
            {
                new Vector3(-6f, 1.5f, 6f),
                new Vector3(6f, 1.5f, 6f),
                new Vector3(-6f, 1.5f, -3f),
            };
            foreach (var pos in pillarPositions)
            {
                var pillar = CreatePrimitiveNoCollider(PrimitiveType.Cube, "Pillar", env.transform);
                pillar.transform.position = pos;
                pillar.transform.localScale = new Vector3(0.8f, 3f, 0.8f);
                pillar.GetComponent<MeshRenderer>().sharedMaterial = pillarMat;
            }

            // A couple of flat parking-bay lines — thin cubes, purely
            // cosmetic ground markings, never an object of evidentiary
            // interest.
            for (var i = 0; i < 4; i++)
            {
                var line = CreatePrimitiveNoCollider(PrimitiveType.Cube, "ParkingLine", env.transform);
                line.transform.position = new Vector3(-9f + i * 3f, 0.01f, 2f);
                line.transform.localScale = new Vector3(0.08f, 0.01f, 6f);
                line.GetComponent<MeshRenderer>().sharedMaterial = lineMat;
            }
        }

        private static void AddWall(Transform parent, Material mat, Vector3 pos, Vector3 scale)
        {
            var wall = CreatePrimitiveNoCollider(PrimitiveType.Cube, "Wall", parent);
            wall.transform.position = pos;
            wall.transform.localScale = scale;
            wall.GetComponent<MeshRenderer>().sharedMaterial = mat;
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
            var root = new GameObject("actor-1"); // name MUST match the JSON `visualId`
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
