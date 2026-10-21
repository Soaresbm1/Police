using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using Caseline.CCTVEditor;
using Caseline.Reconstruction;
using UnityEditor;
using UnityEditor.Animations;
using UnityEngine;

namespace Caseline.ReconstructionEditor
{
    /// <summary>
    /// Dev-only: builds the optional character kit (Resources/OfficeKit/Actors) from the locally installed Synty
    /// POLYGON Office characters. Called at the end of <see cref="OfficeKitBuilder.Build"/>, which has just converted the
    /// pack's materials and emptied the kit folder.
    ///
    /// The mannequin's ten animation clips (Assets/Animations/Reconstruction_*.anim) are authored for the mannequin's own
    /// simple rig, so they cannot drive the Synty skeleton directly. Instead they are baked across: each clip is sampled
    /// on a mannequin, and every mapped Synty bone is given the mannequin bone's WORLD-space rotation change from its rest
    /// pose, applied to the Synty bone's own rest pose. Working in world space makes the bones' different local axes
    /// irrelevant. The Synty characters are modelled in a T-pose, so their arms are first dropped to hang at the sides
    /// (the mannequin's rest pose), or an arm swing about the right axis would just spin the arm about its own length.
    /// Hip height is scaled in proportion, so a crouch or collapse keeps the feet on the floor. The result is ordinary
    /// transform-curve clips and one controller with the mannequin's state names, so ReconstructionActorController plays
    /// them unchanged.
    ///
    /// All 18 characters share one skeleton, so one set of clips serves every prefab. Each actor prefab keeps only its
    /// own skinned mesh (the pack's prefab carries all 18 as disabled siblings) and is scaled to the mannequin's 1.78 m,
    /// the height every framing measurement assumes.
    /// </summary>
    public static class SyntyActorBuilder
    {
        public const string ActorFolder = OfficeKitBuilder.KitRoot + "/Actors";
        private const string ModelName = "Model";
        private const float ActorHeight = 1.78f;
        private const float MannequinHipsHeight = 0.92f;
        private const float ArmDropDegrees = 78f;
        private const int SamplesPerClip = 30;

        private static readonly string[] States =
        {
            "Idle", "Walk", "AttackStrike", "AttackStrangle", "AttackStab", "AttackFirearm", "AttackPush", "NeutralInteraction", "ManipulateScene", "Collapse",
        };

        // Mannequin bone path (relative to its root) -> Synty bone name, parents before children.
        private static readonly (string mannequin, string synty)[] Map =
        {
            ("Hips", "Hips"),
            ("Hips/Spine", "Spine_01"),
            ("Hips/Spine/Chest", "Spine_02"),
            ("Hips/Spine/Chest/Neck", "Neck"),
            ("Hips/Spine/Chest/Neck/Head", "Head"),
            ("Hips/Spine/Chest/LeftUpperArm", "Shoulder_L"),
            ("Hips/Spine/Chest/LeftUpperArm/LeftLowerArm", "Elbow_L"),
            ("Hips/Spine/Chest/LeftUpperArm/LeftLowerArm/LeftHand", "Hand_L"),
            ("Hips/Spine/Chest/RightUpperArm", "Shoulder_R"),
            ("Hips/Spine/Chest/RightUpperArm/RightLowerArm", "Elbow_R"),
            ("Hips/Spine/Chest/RightUpperArm/RightLowerArm/RightHand", "Hand_R"),
            ("Hips/LeftUpperLeg", "UpperLeg_L"),
            ("Hips/LeftUpperLeg/LeftLowerLeg", "LowerLeg_L"),
            ("Hips/LeftUpperLeg/LeftLowerLeg/LeftFoot", "Ankle_L"),
            ("Hips/RightUpperLeg", "UpperLeg_R"),
            ("Hips/RightUpperLeg/RightLowerLeg", "LowerLeg_R"),
            ("Hips/RightUpperLeg/RightLowerLeg/RightFoot", "Ankle_R"),
        };

        public static void Build(StringBuilder report)
        {
            var names = ReconstructionActorKit.CharacterTable.SelectMany(r => r).Distinct().ToList();
            Directory.CreateDirectory(ActorFolder);
            AssetDatabase.Refresh();

            var packPrefabs = AssetDatabase.FindAssets("t:Prefab", new[] { OfficeKitBuilder.PackRoot + "/Prefabs/Characters" })
                .Select(AssetDatabase.GUIDToAssetPath)
                .ToDictionary(Path.GetFileNameWithoutExtension, p => p);

            var (maleController, femaleController) = BakeControllers(packPrefabs[names[0]], report);

            report.AppendLine();
            report.AppendLine("actor | mesh top (m) | scale | skinned renderers kept | verts");
            foreach (var name in names)
            {
                var rig = NewRig(packPrefabs[name]);
                var own = KeepOnlyOwnMesh(rig, name);
                own.sharedMaterials = own.sharedMaterials.Select(ActorMaterial).ToArray();
                // Scale from the mesh's real vertex extent (its stored bounds are conservative for a skinned mesh) and lift the
                // model so the lowest vertex, the sole of a shoe, sits exactly on the floor.
                var vertices = own.sharedMesh.vertices;
                var meshBottom = vertices.Min(v => v.y);
                var meshTop = vertices.Max(v => v.y);
                var scale = ActorHeight / (meshTop - meshBottom);

                var actor = new GameObject(name + "_Actor");
                var animator = actor.AddComponent<Animator>();
                animator.runtimeAnimatorController = name.Contains("_Female_") ? femaleController : maleController;
                animator.applyRootMotion = false;
                rig.transform.SetParent(actor.transform, false);
                rig.transform.localScale = Vector3.one * scale;
                rig.transform.localPosition = new Vector3(0f, -meshBottom * scale, 0f);
                ApplyArmDrop(rig.transform);

                actor.AddComponent<ReconstructionActorController>().SetAnimator(animator);
                actor.AddComponent<ReconstructionKitActor>();

                report.AppendLine($"{name} | {meshBottom:F3}..{meshTop:F3} | {scale:F3} | {actor.GetComponentsInChildren<SkinnedMeshRenderer>(true).Length} | {own.sharedMesh.vertexCount}");
                PrefabUtility.SaveAsPrefabAsset(actor, $"{ActorFolder}/{name}_Actor.prefab");
                UnityEngine.Object.DestroyImmediate(actor);
            }
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
        }

        // ---- rig helpers ----

        /// <summary>A scene instance of a pack character with the pack's own Animator removed, renamed <see cref="ModelName"/>.</summary>
        private static GameObject NewRig(string prefabPath)
        {
            var rig = (GameObject)PrefabUtility.InstantiatePrefab(AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath));
            PrefabUtility.UnpackPrefabInstance(rig, PrefabUnpackMode.Completely, InteractionMode.AutomatedAction);
            var animator = rig.GetComponent<Animator>();
            if (animator != null) UnityEngine.Object.DestroyImmediate(animator);
            rig.name = ModelName;
            rig.transform.SetPositionAndRotation(Vector3.zero, Quaternion.identity);
            rig.transform.localScale = Vector3.one;
            return rig;
        }

        private static SkinnedMeshRenderer KeepOnlyOwnMesh(GameObject rig, string name)
        {
            foreach (var smr in rig.GetComponentsInChildren<SkinnedMeshRenderer>(true).ToList())
            {
                if (smr.gameObject.name != name) UnityEngine.Object.DestroyImmediate(smr.gameObject);
            }
            var own = rig.GetComponentsInChildren<SkinnedMeshRenderer>(true).Single();
            own.gameObject.SetActive(true);
            own.updateWhenOffscreen = true; // the baked pose moves far outside the T-pose bounds the mesh was authored with
            own.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.On; // the people cast the shadows that ground them
            own.receiveShadows = true;
            foreach (var l in rig.GetComponentsInChildren<Light>(true)) UnityEngine.Object.DestroyImmediate(l);
            return own;
        }

        /// <summary>The scene's dim ambient light leaves the pack's dark outfits nearly black next to the pale blockout
        /// floor, so the people get their own copy of the atlas material with a gentle emission of the albedo itself: a
        /// fixed lift of the textures' own colours, no tint, no per-actor variation.</summary>
        private static Material ActorMaterial(Material source)
        {
            var path = $"{ActorFolder}/Actor_{source.name}.mat";
            var existing = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (existing != null) return existing;
            var copy = new Material(source) { name = $"Actor_{source.name}" };
            if (copy.mainTexture != null)
            {
                copy.EnableKeyword("_EMISSION");
                copy.SetTexture("_EmissionMap", copy.mainTexture);
                copy.SetColor("_EmissionColor", new Color(ActorEmission, ActorEmission, ActorEmission));
                copy.globalIlluminationFlags = MaterialGlobalIlluminationFlags.None;
            }
            AssetDatabase.CreateAsset(copy, path);
            return copy;
        }

        private const float ActorEmission = 0.45f;

        private static Transform Find(Transform root, string name)
        {
            return root.GetComponentsInChildren<Transform>(true).First(t => t.name == name);
        }

        /// <summary>Drops both arms from the T-pose to hang at the sides, about the world forward axis through each
        /// shoulder. Children keep their local pose, so the whole arm follows.</summary>
        private static void ApplyArmDrop(Transform model)
        {
            Find(model, "Shoulder_L").rotation = Quaternion.AngleAxis(ArmDropDegrees, Vector3.forward) * Find(model, "Shoulder_L").rotation;
            Find(model, "Shoulder_R").rotation = Quaternion.AngleAxis(-ArmDropDegrees, Vector3.forward) * Find(model, "Shoulder_R").rotation;
        }

        // ---- baking ----

        // States that have a Synty motion-capture clip when the animation packs are installed (see BakeMocapClip). Each
        // state lists its source segments by file name; "{g}" is Masc or Femn. The neutral attack, strangle, stab, firearm,
        // push and handing beats stay baked from the mannequin: the packs hold no neutral clip for them (the combat packs
        // are sword and bow fights, the emotes carry moods), and an emotion or a weapon pose would break the truth boundary.
        private readonly struct Seg
        {
            public readonly string File;
            public readonly float U0;
            public readonly float U1;

            public Seg(string file, float u0, float u1)
            {
                File = file;
                U0 = u0;
                U1 = u1;
            }
        }

        // The death clip is gender-neutral (one file); it replaces the mannequin's collapse for both.
        private const string DeathClip = "A_Death_F_01_Sword";

        private static readonly (string state, Seg[] segments)[] MocapStates =
        {
            ("Idle", new[] { new Seg("A_Idle_Standing_{g}", 0f, 1f) }),
            ("Walk", new[] { new Seg("A_Walk_F_{g}", 0f, 1f) }),
            ("ManipulateScene", new[] { new Seg("A_Stand_ToCrouch_{g}", 0f, 0.4f), new Seg("A_Idle_Crouching_{g}", 0.4f, 1f) }),
            ("Collapse", new[] { new Seg(DeathClip, 0f, 1f) }),
        };

        private static (AnimatorController male, AnimatorController female) BakeControllers(string prefabPath, StringBuilder report)
        {
            var bakeRoot = new GameObject("SyntyBakeRoot");
            var model = NewRig(prefabPath);
            model.transform.SetParent(bakeRoot.transform, false);
            ApplyArmDrop(model.transform);

            // A second rig that keeps the pack's Animator and Avatar, used to sample the humanoid motion-capture clips.
            var mocapRig = (GameObject)PrefabUtility.InstantiatePrefab(AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath));
            mocapRig.transform.SetPositionAndRotation(Vector3.zero, Quaternion.identity);

            var mannequinRoot = CCTVPrototypeBuilder.BuildActor();
            try
            {
                var shared = new List<(string state, AnimationClip clip)>();
                foreach (var state in States)
                {
                    var source = AssetDatabase.LoadAssetAtPath<AnimationClip>($"Assets/Animations/Reconstruction/Reconstruction_{state}.anim");
                    if (source == null) throw new InvalidOperationException($"missing source clip for {state}");
                    var baked = BakeClip(state, source, bakeRoot.transform, model.transform, mannequinRoot.transform);
                    AssetDatabase.CreateAsset(baked, $"{ActorFolder}/Synty_{state}.anim");
                    shared.Add((state, baked));
                    report.AppendLine($"baked {state} from the mannequin: length={baked.length:F2}s");
                }

                var controllers = new List<AnimatorController>();
                foreach (var (suffix, tag, label) in new[] { ("Masc", "Male", "male"), ("Femn", "Female", "female") })
                {
                    var clips = new List<(string state, AnimationClip clip)>(shared);
                    foreach (var (state, segments) in MocapStates)
                    {
                        var resolved = segments.Select(s => (clip: LoadMocap(s.File.Replace("{g}", suffix)), u0: s.U0, u1: s.U1)).ToArray();
                        var index = clips.FindIndex(c => c.state == state);
                        if (resolved.Any(r => r.clip == null) || mocapRig.GetComponent<Animator>()?.avatar == null)
                        {
                            report.AppendLine($"{label} {state}: motion-capture clip not installed, keeping the mannequin bake");
                            continue;
                        }
                        var clip = BakeMocapClip(state, resolved, mocapRig);
                        AssetDatabase.CreateAsset(clip, $"{ActorFolder}/Synty_{state}_{tag}.anim");
                        clips[index] = (state, clip);
                        report.AppendLine($"baked {state} for {label} from motion capture: length={clip.length:F2}s");
                    }
                    AssetDatabase.SaveAssets();

                    var controller = AnimatorController.CreateAnimatorControllerAtPath($"{ActorFolder}/Synty_Actor_{tag}.controller");
                    var machine = controller.layers[0].stateMachine;
                    foreach (var (state, clip) in clips)
                    {
                        var s = machine.AddState(state);
                        s.motion = clip;
                        s.writeDefaultValues = true;
                        if (state == "Idle") machine.defaultState = s;
                    }
                    controllers.Add(controller);
                }
                return (controllers[0], controllers[1]);
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(bakeRoot);
                UnityEngine.Object.DestroyImmediate(mocapRig);
                UnityEngine.Object.DestroyImmediate(mannequinRoot.transform.parent != null ? mannequinRoot.transform.parent.gameObject : mannequinRoot);
            }
        }

        private const string MocapRoot = "Assets/ThirdParty/Synty";

        /// <summary>The humanoid clip inside a locally installed Synty animation FBX, or null when that pack is not installed.</summary>
        private static AnimationClip LoadMocap(string fileName)
        {
            if (!AssetDatabase.IsValidFolder(MocapRoot)) return null;
            var path = AssetDatabase.FindAssets(fileName + " t:Model", new[] { MocapRoot })
                .Select(AssetDatabase.GUIDToAssetPath)
                .FirstOrDefault(p => Path.GetFileNameWithoutExtension(p) == fileName);
            if (path == null) return null;
            return AssetDatabase.LoadAllAssetsAtPath(path).OfType<AnimationClip>().FirstOrDefault(c => !c.name.StartsWith("__preview__"));
        }

        /// <summary>Samples humanoid motion-capture clips on the character's own Avatar (so Unity does the retargeting) and
        /// records every body bone's local rotation, plus the hips position, as ordinary transform curves. The segments
        /// are stitched along the baked clip's normalized time. Root motion is left out: the timeline moves the actor, the
        /// clip only supplies the body's own movement relative to its root.</summary>
        private static AnimationClip BakeMocapClip(string state, (AnimationClip clip, float u0, float u1)[] segments, GameObject rig)
        {
            var rigRoot = rig.transform;
            var bones = rig.GetComponentsInChildren<Transform>(true)
                .Where(t => t != rigRoot && t.name != "Root" && !t.name.StartsWith("SM_Chr_") && t.name != "Eyes" && t.name != "Eyebrows" && t.name != "Jaw")
                .ToArray();
            var hips = bones.First(b => b.name == "Hips");
            var length = Mathf.Max(0.5f, segments.Sum(s => s.clip.length));
            var samples = Mathf.Max(SamplesPerClip, Mathf.CeilToInt(length * 30f));

            var rotationKeys = bones.Select(_ => new List<Quaternion>()).ToArray();
            var hipsKeys = new List<Vector3>();
            var times = new List<float>();
            for (var i = 0; i <= samples; i++)
            {
                var u = i / (float)samples;
                var seg = segments.Last(s => u >= s.u0 - 0.0001f);
                var local = Mathf.Clamp01((u - seg.u0) / Mathf.Max(0.0001f, seg.u1 - seg.u0));
                rigRoot.SetPositionAndRotation(Vector3.zero, Quaternion.identity);
                seg.clip.SampleAnimation(rig, local * seg.clip.length);
                rigRoot.SetPositionAndRotation(Vector3.zero, Quaternion.identity);

                for (var b = 0; b < bones.Length; b++)
                {
                    var q = bones[b].localRotation;
                    if (rotationKeys[b].Count > 0 && Quaternion.Dot(rotationKeys[b][rotationKeys[b].Count - 1], q) < 0f) q = new Quaternion(-q.x, -q.y, -q.z, -q.w);
                    rotationKeys[b].Add(q);
                }
                hipsKeys.Add(hips.localPosition);
                times.Add(u * length);
            }

            var result = new AnimationClip { legacy = false, name = state, frameRate = 30f };
            if (state == "Walk")
            {
                result.wrapMode = WrapMode.Loop;
                var settings = AnimationUtility.GetAnimationClipSettings(result);
                settings.loopTime = true;
                AnimationUtility.SetAnimationClipSettings(result, settings);
            }
            for (var b = 0; b < bones.Length; b++)
            {
                var path = ModelName + "/" + AnimationUtility.CalculateTransformPath(bones[b], rigRoot);
                SetCurve(result, path, "localRotation.x", times, rotationKeys[b].Select(q => q.x).ToList());
                SetCurve(result, path, "localRotation.y", times, rotationKeys[b].Select(q => q.y).ToList());
                SetCurve(result, path, "localRotation.z", times, rotationKeys[b].Select(q => q.z).ToList());
                SetCurve(result, path, "localRotation.w", times, rotationKeys[b].Select(q => q.w).ToList());
            }
            var hipsPath = ModelName + "/" + AnimationUtility.CalculateTransformPath(hips, rigRoot);
            SetCurve(result, hipsPath, "localPosition.x", times, hipsKeys.Select(v => v.x).ToList());
            SetCurve(result, hipsPath, "localPosition.y", times, hipsKeys.Select(v => v.y).ToList());
            SetCurve(result, hipsPath, "localPosition.z", times, hipsKeys.Select(v => v.z).ToList());
            return result;
        }

        private static AnimationClip BakeClip(string state, AnimationClip source, Transform bakeRoot, Transform model, Transform mannequinRoot)
        {
            var mannequinBones = Map.Select(m => mannequinRoot.Find(m.mannequin)).ToArray();
            var syntyBones = Map.Select(m => Find(model, m.synty)).ToArray();
            if (mannequinBones.Any(b => b == null)) throw new InvalidOperationException("a mannequin bone is missing: " + string.Join(", ", Map.Where((m, i) => mannequinBones[i] == null).Select(m => m.mannequin)));

            // Rest poses: the mannequin's bind pose and the Synty arms-down pose.
            var mannequinAll = mannequinRoot.GetComponentsInChildren<Transform>(true);
            var mannequinBind = mannequinAll.Select(t => (t.localPosition, t.localRotation)).ToArray();
            var mannequinRest = mannequinBones.Select(b => b.rotation).ToArray();
            var syntyRest = syntyBones.Select(b => b.rotation).ToArray();
            var hips = syntyBones[0];
            var hipsRestLocal = hips.localPosition;

            var length = Mathf.Max(source.length, 0.01f);
            var rotationKeys = syntyBones.Select(_ => new List<Quaternion>()).ToArray();
            var hipsKeys = new List<Vector3>();
            var times = new List<float>();

            for (var i = 0; i <= SamplesPerClip; i++)
            {
                var t = length * i / SamplesPerClip;
                for (var k = 0; k < mannequinAll.Length; k++)
                {
                    mannequinAll[k].localPosition = mannequinBind[k].localPosition;
                    mannequinAll[k].localRotation = mannequinBind[k].localRotation;
                }
                source.SampleAnimation(mannequinRoot.gameObject, t);

                for (var b = 0; b < Map.Length; b++)
                {
                    var delta = mannequinBones[b].rotation * Quaternion.Inverse(mannequinRest[b]);
                    syntyBones[b].rotation = delta * syntyRest[b];
                }
                hips.localPosition = new Vector3(hipsRestLocal.x, hipsRestLocal.y * (mannequinBones[0].position.y / MannequinHipsHeight), hipsRestLocal.z);

                for (var b = 0; b < Map.Length; b++)
                {
                    var q = syntyBones[b].localRotation;
                    if (rotationKeys[b].Count > 0 && Quaternion.Dot(rotationKeys[b][rotationKeys[b].Count - 1], q) < 0f) q = new Quaternion(-q.x, -q.y, -q.z, -q.w);
                    rotationKeys[b].Add(q);
                }
                hipsKeys.Add(hips.localPosition);
                times.Add(t);
            }

            // Leave the rigs as they were found.
            for (var k = 0; k < mannequinAll.Length; k++)
            {
                mannequinAll[k].localPosition = mannequinBind[k].localPosition;
                mannequinAll[k].localRotation = mannequinBind[k].localRotation;
            }
            for (var b = 0; b < Map.Length; b++) syntyBones[b].rotation = syntyRest[b];
            hips.localPosition = hipsRestLocal;

            var clip = new AnimationClip { legacy = false, name = state, frameRate = 30f };
            if (state == "Walk")
            {
                clip.wrapMode = WrapMode.Loop;
                var settings = AnimationUtility.GetAnimationClipSettings(clip);
                settings.loopTime = true;
                AnimationUtility.SetAnimationClipSettings(clip, settings);
            }

            for (var b = 0; b < Map.Length; b++)
            {
                var path = AnimationUtility.CalculateTransformPath(syntyBones[b], bakeRoot);
                SetCurve(clip, path, "localRotation.x", times, rotationKeys[b].Select(q => q.x).ToList());
                SetCurve(clip, path, "localRotation.y", times, rotationKeys[b].Select(q => q.y).ToList());
                SetCurve(clip, path, "localRotation.z", times, rotationKeys[b].Select(q => q.z).ToList());
                SetCurve(clip, path, "localRotation.w", times, rotationKeys[b].Select(q => q.w).ToList());
            }
            var hipsPath = AnimationUtility.CalculateTransformPath(hips, bakeRoot);
            SetCurve(clip, hipsPath, "localPosition.x", times, hipsKeys.Select(v => v.x).ToList());
            SetCurve(clip, hipsPath, "localPosition.y", times, hipsKeys.Select(v => v.y).ToList());
            SetCurve(clip, hipsPath, "localPosition.z", times, hipsKeys.Select(v => v.z).ToList());
            return clip;
        }

        private static void SetCurve(AnimationClip clip, string path, string property, List<float> times, List<float> values)
        {
            var curve = new AnimationCurve();
            for (var i = 0; i < times.Count; i++) curve.AddKey(new Keyframe(times[i], values[i]));
            for (var i = 0; i < curve.length; i++)
            {
                AnimationUtility.SetKeyLeftTangentMode(curve, i, AnimationUtility.TangentMode.Linear);
                AnimationUtility.SetKeyRightTangentMode(curve, i, AnimationUtility.TangentMode.Linear);
            }
            clip.SetCurve(path, typeof(Transform), property, curve);
        }
    }
}
