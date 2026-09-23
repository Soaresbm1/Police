using UnityEditor;
using UnityEngine;

namespace Caseline.ReconstructionEditor
{
    /// <summary>
    /// Phase U5.6 iteration 2 — Reconstruction-only actor silhouette polish. Called exactly once, by
    /// <see cref="ReconstructionSceneBuilder.BuildActorTemplate"/>, on the GameObject tree
    /// <c>Caseline.CCTVEditor.CCTVPrototypeBuilder.BuildActor()</c> just returned (that method's own doc comment
    /// confirms it always constructs a brand-new hierarchy — nothing here can ever reach or mutate CCTV's own
    /// scene/actor). Every addition is a NEW sibling child parented under an EXISTING bone Transform that method
    /// already created (never a rename, reparent, or removal of anything CCTV built), using the exact same
    /// "add a small sphere at the joint" technique CCTV's own code already validated for shoulders — this file just
    /// extends that same idea to the hips, elbows, wrists, knees and ankles CCTV's own far-away wide shot never
    /// needed to bother with, plus one new waist-blend piece on the Spine bone (which CCTV's own builder leaves
    /// completely bare today).
    ///
    /// Editor-only, one-time authoring — exactly like <c>CCTVPrototypeBuilder.AddVisual</c>, this calls
    /// `GameObject.CreatePrimitive` directly and strips its Collider immediately, which is safe here because the
    /// result is baked into the SAVED scene at build time, never constructed again at WebGL runtime (unlike
    /// `ReconstructionEnvironmentController`, which rebuilds environment geometry live from loaded JSON and must
    /// avoid `CreatePrimitive` for exactly that reason — see that file's own doc comment).
    ///
    /// Truth-safety / identity-safety: every dimension below is a fixed constant, the same for every actor
    /// regardless of role, visualId or genericAppearance — there is no branch anywhere in this file on any of
    /// those. `ReconstructionActorController.ApplyGenericAppearance` tints every child Renderer uniformly
    /// (including everything added here) after `Configure` runs, so these new joints automatically pick up the
    /// same presentation-only tone every other visual piece already gets, with zero extra material code.
    /// </summary>
    public static class ReconstructionActorVisualPolish
    {
        // Sized to sit between the two limb segments they join, per CCTVPrototypeBuilder's own documented
        // dimensions (ChestLength/NeckLength/UpperArmLength/etc. — see that file): each cap's diameter is close to
        // the wider of its two neighboring segment widths, so it reads as a rounded transition rather than a new,
        // separately-noticeable ball — the same effect CCTV's own shoulder caps (0.13, matching the chest/arm
        // junction) already achieve.
        private const float HipCapDiameter = 0.17f; // between pelvis (0.28/0.18) and upper leg (0.16) width
        private const float ElbowCapDiameter = 0.085f; // between upper arm (0.09) and lower arm (0.075) width
        private const float WristCapDiameter = 0.075f; // between lower arm (0.075) and hand (0.075/0.06) width
        private const float KneeCapDiameter = 0.145f; // between upper leg (0.16) and lower leg (0.13) width
        private const float AnkleCapDiameter = 0.13f; // between lower leg (0.13) and foot (0.14/0.06) width

        // A short, slightly-narrower-than-chest box on the previously-bare Spine bone (Hips -> Spine -> Chest),
        // giving the hips (0.28 wide) -> chest (0.36 wide) jump one visible intermediate step instead of a single
        // hard edge — the torso/pelvis transition item 11 of the iteration-2 prompt calls the highest-value area.
        private static readonly Vector3 WaistScale = new(0.30f, 0.10f, 0.19f);

        public static void Apply(GameObject actorRoot)
        {
            var mat = FindAnyExistingBodyMaterial(actorRoot);

            AddWaistBlend(actorRoot, mat);
            AddJointCap(actorRoot, "LeftUpperLeg", HipCapDiameter, mat);
            AddJointCap(actorRoot, "RightUpperLeg", HipCapDiameter, mat);
            AddJointCap(actorRoot, "LeftLowerArm", ElbowCapDiameter, mat);
            AddJointCap(actorRoot, "RightLowerArm", ElbowCapDiameter, mat);
            AddJointCap(actorRoot, "LeftHand", WristCapDiameter, mat);
            AddJointCap(actorRoot, "RightHand", WristCapDiameter, mat);
            AddJointCap(actorRoot, "LeftLowerLeg", KneeCapDiameter, mat);
            AddJointCap(actorRoot, "RightLowerLeg", KneeCapDiameter, mat);
            AddJointCap(actorRoot, "LeftFoot", AnkleCapDiameter, mat);
            AddJointCap(actorRoot, "RightFoot", AnkleCapDiameter, mat);
        }

        private static void AddWaistBlend(GameObject actorRoot, Material mat)
        {
            var spine = FindDeep(actorRoot.transform, "Spine");
            if (spine == null) return; // fail closed: never throws if CCTV's bone names ever change
            AddVisual(spine, PrimitiveType.Cube, Vector3.zero, WaistScale, mat, "WaistBlend");
        }

        private static void AddJointCap(GameObject actorRoot, string boneName, float diameter, Material mat)
        {
            var bone = FindDeep(actorRoot.transform, boneName);
            if (bone == null) return; // fail closed: never throws if CCTV's bone names ever change
            AddVisual(bone, PrimitiveType.Sphere, Vector3.zero, new Vector3(diameter, diameter, diameter), mat, "JointCap");
        }

        private static void AddVisual(Transform bone, PrimitiveType type, Vector3 localOffset, Vector3 scale, Material mat, string name)
        {
            var go = GameObject.CreatePrimitive(type);
            go.name = name;
            var collider = go.GetComponent<Collider>();
            if (collider != null) Object.DestroyImmediate(collider);
            go.transform.SetParent(bone, false);
            go.transform.localPosition = localOffset;
            go.transform.localScale = scale;
            if (mat != null) go.GetComponent<MeshRenderer>().sharedMaterial = mat;
        }

        /// <summary>Reuses whatever material CCTV's own builder already applied to the actor (found on the Hips
        /// visual, the first one built) rather than creating a second material asset — every new piece added here
        /// gets the exact same base look, and `ApplyGenericAppearance`'s later per-instance tint (which sets
        /// `renderer.material.color`, instantiating its own per-renderer material automatically) still applies
        /// uniformly on top, exactly as it already does for every other renderer.</summary>
        private static Material FindAnyExistingBodyMaterial(GameObject actorRoot)
        {
            var renderer = actorRoot.GetComponentInChildren<MeshRenderer>();
            return renderer != null ? renderer.sharedMaterial : null;
        }

        private static Transform FindDeep(Transform root, string name)
        {
            if (root.name == name) return root;
            for (var i = 0; i < root.childCount; i++)
            {
                var found = FindDeep(root.GetChild(i), name);
                if (found != null) return found;
            }
            return null;
        }
    }
}
