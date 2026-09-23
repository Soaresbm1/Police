using UnityEditor;
using UnityEngine;
using Caseline.Reconstruction;

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
        private const float ElbowCapDiameter = 0.085f; // between upper arm (0.09) and lower arm (0.075) width
        private const float WristCapDiameter = 0.075f; // between lower arm (0.075) and hand (0.075/0.06) width
        private const float KneeCapDiameter = 0.145f; // between upper leg (0.16) and lower leg (0.13) width
        private const float AnkleCapDiameter = 0.13f; // between lower leg (0.13) and foot (0.14/0.06) width

        // A short, slightly-narrower-than-chest box on the previously-bare Spine bone (Hips -> Spine -> Chest),
        // giving the hips (0.28 wide) -> chest (0.36 wide) jump one visible intermediate step instead of a single
        // hard edge — the torso/pelvis transition item 11 of the iteration-2 prompt calls the highest-value area.
        private static readonly Vector3 WaistScale = new(0.30f, 0.10f, 0.19f);

        // Iteration 3 — large-form silhouette work (goal: read as human at ACTUAL gameplay camera distance, not
        // under a debug close-up). Chest(0.36) -> ChestTaper(0.33) -> Waist(0.30) -> Hips(0.28) turns one hard
        // shoulder-to-hip edge into a 4-step gradient instead of iteration 2's single intermediate step.
        private static readonly Vector3 ChestTaperScale = new(0.33f, 0.09f, 0.195f);

        // Widened from iteration 2's 0.17 — at gameplay camera distance the old size read as a barely-visible dot
        // next to the 0.28-wide pelvis box; 0.20 makes the hip/thigh transition an actual visible bridge instead of
        // a hard step, without approaching the pelvis's own width (avoids a "wider than the body" artifact).
        private const float HipCapDiameterV3 = 0.20f;

        // Iteration 3 limb taper (item 8): a lightweight WIDTH-only (X/Z) step between the upper and lower segment
        // of each limb, applied to the existing CCTV-built "Visual" child on Reconstruction's OWN actor instance —
        // never CCTV's. Height (Y) is left untouched on purpose: rescaling Y would change the bone-to-bone distance
        // the parent already fixed via localPosition offsets in CCTVPrototypeBuilder, and could visually separate a
        // segment from its neighboring joint. Values are deliberately small — this is meant to read as a taper, not
        // a bodybuilder silhouette.
        private const float UpperLimbWidthFactor = 1.10f;
        private const float LowerLimbWidthFactor = 0.90f;

        public static void Apply(GameObject actorRoot)
        {
            var mat = FindAnyExistingBodyMaterial(actorRoot);

            AddWaistBlend(actorRoot, mat);
            AddChestTaper(actorRoot, mat);
            AddJointCap(actorRoot, "LeftUpperLeg", HipCapDiameterV3, mat);
            AddJointCap(actorRoot, "RightUpperLeg", HipCapDiameterV3, mat);
            AddJointCap(actorRoot, "LeftLowerArm", ElbowCapDiameter, mat);
            AddJointCap(actorRoot, "RightLowerArm", ElbowCapDiameter, mat);
            AddJointCap(actorRoot, "LeftHand", WristCapDiameter, mat);
            AddJointCap(actorRoot, "RightHand", WristCapDiameter, mat);
            AddJointCap(actorRoot, "LeftLowerLeg", KneeCapDiameter, mat);
            AddJointCap(actorRoot, "RightLowerLeg", KneeCapDiameter, mat);
            AddJointCap(actorRoot, "LeftFoot", AnkleCapDiameter, mat);
            AddJointCap(actorRoot, "RightFoot", AnkleCapDiameter, mat);

            ApplyLimbTaper(actorRoot, "LeftUpperArm", UpperLimbWidthFactor);
            ApplyLimbTaper(actorRoot, "RightUpperArm", UpperLimbWidthFactor);
            ApplyLimbTaper(actorRoot, "LeftLowerArm", LowerLimbWidthFactor);
            ApplyLimbTaper(actorRoot, "RightLowerArm", LowerLimbWidthFactor);
            ApplyLimbTaper(actorRoot, "LeftUpperLeg", UpperLimbWidthFactor);
            ApplyLimbTaper(actorRoot, "RightUpperLeg", UpperLimbWidthFactor);
            ApplyLimbTaper(actorRoot, "LeftLowerLeg", LowerLimbWidthFactor);
            ApplyLimbTaper(actorRoot, "RightLowerLeg", LowerLimbWidthFactor);

            TagMaterialBands(actorRoot);
        }

        private static void AddWaistBlend(GameObject actorRoot, Material mat)
        {
            var spine = FindDeep(actorRoot.transform, "Spine");
            if (spine == null) return; // fail closed: never throws if CCTV's bone names ever change
            AddVisual(spine, PrimitiveType.Cube, Vector3.zero, WaistScale, mat, "WaistBlend");
        }

        private static void AddChestTaper(GameObject actorRoot, Material mat)
        {
            var chest = FindDeep(actorRoot.transform, "Chest");
            if (chest == null) return; // fail closed: never throws if CCTV's bone names ever change
            // Sits at the bottom of the Chest bone's own local space (Chest's own Visual is centered at +0.08 on Y
            // per CCTVPrototypeBuilder — see its own AddVisual call), i.e. just above where Spine begins.
            AddVisual(chest, PrimitiveType.Cube, new Vector3(0, -0.03f, 0), ChestTaperScale, mat, "ChestTaper");
        }

        private static void AddJointCap(GameObject actorRoot, string boneName, float diameter, Material mat)
        {
            var bone = FindDeep(actorRoot.transform, boneName);
            if (bone == null) return; // fail closed: never throws if CCTV's bone names ever change
            AddVisual(bone, PrimitiveType.Sphere, Vector3.zero, new Vector3(diameter, diameter, diameter), mat, "JointCap");
        }

        /// <summary>Rescales the WIDTH (X/Z) only of the existing CCTV-built "Visual" child under `boneName`, on
        /// Reconstruction's own actor instance. Never touches Y (length), so the bone-to-bone distances
        /// CCTVPrototypeBuilder fixed via its own localPosition offsets — and therefore total actor height — are
        /// completely unaffected.</summary>
        private static void ApplyLimbTaper(GameObject actorRoot, string boneName, float widthFactor)
        {
            var bone = FindDeep(actorRoot.transform, boneName);
            var visual = bone != null ? bone.Find("Visual") : null;
            if (visual == null) return; // fail closed: never throws if CCTV's own Visual child is ever renamed/moved
            var scale = visual.localScale;
            visual.localScale = new Vector3(scale.x * widthFactor, scale.y, scale.z * widthFactor);
        }

        /// <summary>U5.6 iteration 3 — tags every renderer added by THIS file, plus every "Visual" renderer
        /// CCTVPrototypeBuilder already built on Reconstruction's own instance, with the head/torso/limb band
        /// <see cref="ReconstructionActorController.ApplyGenericAppearance"/> now reads. Purely additive
        /// (MonoBehaviour components on Reconstruction's own GameObjects) — CCTV's own actor instance is never
        /// touched, so it never gains this component and keeps its original flat-tint behavior.</summary>
        private static void TagMaterialBands(GameObject actorRoot)
        {
            TagBone(actorRoot, "Head", ReconstructionMaterialBand.Head);
            TagBone(actorRoot, "Neck", ReconstructionMaterialBand.Head);
            TagBone(actorRoot, "Chest", ReconstructionMaterialBand.Torso);
            TagBone(actorRoot, "Spine", ReconstructionMaterialBand.Torso);
            TagBone(actorRoot, "Hips", ReconstructionMaterialBand.Torso);
            foreach (var side in new[] { "Left", "Right" })
            {
                TagBone(actorRoot, $"{side}UpperArm", ReconstructionMaterialBand.Limb);
                TagBone(actorRoot, $"{side}LowerArm", ReconstructionMaterialBand.Limb);
                TagBone(actorRoot, $"{side}Hand", ReconstructionMaterialBand.Limb);
                TagBone(actorRoot, $"{side}UpperLeg", ReconstructionMaterialBand.Limb);
                TagBone(actorRoot, $"{side}LowerLeg", ReconstructionMaterialBand.Limb);
                TagBone(actorRoot, $"{side}Foot", ReconstructionMaterialBand.Limb);
            }
        }

        private static void TagBone(GameObject actorRoot, string boneName, ReconstructionMaterialBand band)
        {
            var bone = FindDeep(actorRoot.transform, boneName);
            if (bone == null) return; // fail closed: never throws if CCTV's bone names ever change
            foreach (var renderer in bone.GetComponentsInChildren<Renderer>())
            {
                // Only bands renderers that are DIRECT visual children of this bone (its own "Visual", plus any
                // JointCap/WaistBlend/ChestTaper this file just added there) — never descends into a CHILD bone's
                // own renderers, which get tagged separately when TagBone runs for that child bone name.
                if (renderer.transform.parent == bone)
                {
                    var group = renderer.gameObject.AddComponent<ReconstructionMaterialGroup>();
                    group.band = band;
                }
            }
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
