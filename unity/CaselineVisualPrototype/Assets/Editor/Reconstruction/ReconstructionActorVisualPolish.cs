using UnityEngine;
using Caseline.Reconstruction;

namespace Caseline.ReconstructionEditor
{
    /// <summary>
    /// Phase U5.6 iteration 4 — Reconstruction-only LARGE-FORM redesign of the actor mannequin. Called exactly once, by
    /// <see cref="ReconstructionSceneBuilder.BuildActorTemplate"/>, on the GameObject tree
    /// <c>Caseline.CCTVEditor.CCTVPrototypeBuilder.BuildActor()</c> just returned. That method always builds a brand-new
    /// hierarchy, so nothing here can reach CCTV's own scene, actor, materials or animation clips.
    ///
    /// Iterations 2-3 added small pieces (joint spheres, waist/chest blend boxes, +-10% width steps) that the player-distance
    /// review found invisible — the actor still read as stacked Unity cubes. This iteration changes the big shapes instead:
    /// the existing per-bone "Visual" children (the visual children the brief allows replacing/rescaling) swap their cube
    /// mesh for a purpose-made tapered or faceted mesh. Only mesh + local scale/position of visual children change; every
    /// bone Transform, name and hierarchy path (and therefore every Animator curve) is untouched, and the head keeps the same
    /// world top, so total actor height is unchanged.
    ///
    ///   torso  : narrow waist -> wide shoulders (one tapered form)
    ///   pelvis : hip flare that overlaps the torso bottom and the thigh tops (no gap between torso and legs)
    ///   arms   : shoulder-thick upper arm -> slim forearm;  legs: strong thigh -> tapered calf -> narrow ankle
    ///   head   : faceted egg-shaped mannequin head (no face, hair or identity feature)
    ///
    /// Every dimension is a fixed constant, identical for every actor: there is no branch on role, visualId or
    /// genericAppearance. Material value bands are tagged here and resolved from genericAppearance by
    /// <see cref="ReconstructionActorController"/>.
    /// </summary>
    public static class ReconstructionActorVisualPolish
    {
        // Torso / pelvis: (bottomHalfX, bottomHalfZ, topHalfX, topHalfZ, height). The pelvis top and the torso bottom share
        // the same 0.25 waist width and overlap, so they read as one continuous form.
        private static readonly float[] PelvisDims = { 0.15f, 0.09f, 0.125f, 0.085f, 0.34f };
        private static readonly Vector3 PelvisCenter = new(0f, 0.09f, 0f);
        private static readonly float[] TorsoDims = { 0.125f, 0.09f, 0.20f, 0.105f, 0.40f };
        private static readonly Vector3 TorsoCenter = new(0f, 0.03f, 0f);

        private static readonly float[] UpperArmDims = { 0.038f, 0.038f, 0.055f, 0.05f, 0.30f };
        private static readonly float[] ForearmDims = { 0.027f, 0.027f, 0.038f, 0.038f, 0.27f };
        private static readonly float[] ThighDims = { 0.066f, 0.066f, 0.095f, 0.09f, 0.46f };
        private static readonly float[] CalfDims = { 0.042f, 0.042f, 0.066f, 0.066f, 0.42f };

        // The head keeps CCTV's vertical placement and 0.24 height exactly (total actor height unchanged); only its
        // width/depth narrow so it reads as an egg-shaped mannequin head rather than a ball.
        private static readonly Vector3 HeadScale = new(0.20f, 0.24f, 0.22f);

        private const float HipCapDiameter = 0.20f;
        private const float ElbowCapDiameter = 0.085f;
        private const float KneeCapDiameter = 0.14f;

        public static void Apply(GameObject actorRoot)
        {
            var mat = FindAnyExistingBodyMaterial(actorRoot);

            var pelvis = ReconstructionMeshFactory.Taper("Recon_Pelvis", PelvisDims[0], PelvisDims[1], PelvisDims[2], PelvisDims[3], PelvisDims[4]);
            var torso = ReconstructionMeshFactory.Taper("Recon_Torso", TorsoDims[0], TorsoDims[1], TorsoDims[2], TorsoDims[3], TorsoDims[4]);
            var upperArm = ReconstructionMeshFactory.Taper("Recon_UpperArm", UpperArmDims[0], UpperArmDims[1], UpperArmDims[2], UpperArmDims[3], UpperArmDims[4]);
            var forearm = ReconstructionMeshFactory.Taper("Recon_Forearm", ForearmDims[0], ForearmDims[1], ForearmDims[2], ForearmDims[3], ForearmDims[4]);
            var thigh = ReconstructionMeshFactory.Taper("Recon_Thigh", ThighDims[0], ThighDims[1], ThighDims[2], ThighDims[3], ThighDims[4]);
            var calf = ReconstructionMeshFactory.Taper("Recon_Calf", CalfDims[0], CalfDims[1], CalfDims[2], CalfDims[3], CalfDims[4]);
            var head = ReconstructionMeshFactory.FacetedSphere("Recon_Head", 10, 7, 0.72f);
            var capSphere = ReconstructionMeshFactory.FacetedSphere("Recon_CapSphere", 8, 6, 1f);

            SetVisual(actorRoot, "Hips", pelvis, Vector3.one, PelvisCenter);
            SetVisual(actorRoot, "Chest", torso, Vector3.one, TorsoCenter);
            SetVisual(actorRoot, "Head", head, HeadScale, null);
            foreach (var side in new[] { "Left", "Right" })
            {
                SetVisual(actorRoot, $"{side}UpperArm", upperArm, Vector3.one, null);
                SetVisual(actorRoot, $"{side}LowerArm", forearm, Vector3.one, null);
                SetVisual(actorRoot, $"{side}UpperLeg", thigh, Vector3.one, null);
                SetVisual(actorRoot, $"{side}LowerLeg", calf, Vector3.one, null);
            }

            LowPolyShoulderCaps(actorRoot, capSphere);

            foreach (var side in new[] { "Left", "Right" })
            {
                AddJointCap(actorRoot, $"{side}UpperLeg", HipCapDiameter, mat, capSphere);
                AddJointCap(actorRoot, $"{side}LowerArm", ElbowCapDiameter, mat, capSphere);
                AddJointCap(actorRoot, $"{side}LowerLeg", KneeCapDiameter, mat, capSphere);
            }

            TagMaterialBands(actorRoot);
        }

        private static void SetVisual(GameObject actorRoot, string boneName, Mesh mesh, Vector3 scale, Vector3? localPosition)
        {
            var bone = FindDeep(actorRoot.transform, boneName);
            var visual = bone != null ? bone.Find("Visual") : null;
            var filter = visual != null ? visual.GetComponent<MeshFilter>() : null;
            if (filter == null) return; // fail closed: never throws if CCTV's bone/visual names ever change
            filter.sharedMesh = mesh;
            visual.localScale = scale;
            if (localPosition.HasValue) visual.localPosition = localPosition.Value;
        }

        /// <summary>CCTV builds the two shoulder caps as full 768-triangle Unity spheres; on Reconstruction's own
        /// instance they use the same 0.13 size with the light faceted sphere, matching the new torso facets.</summary>
        private static void LowPolyShoulderCaps(GameObject actorRoot, Mesh capSphere)
        {
            var chest = FindDeep(actorRoot.transform, "Chest");
            if (chest == null) return;
            foreach (Transform child in chest)
            {
                if (child.name != "Visual" || Mathf.Abs(child.localPosition.x) < 0.05f) continue;
                var filter = child.GetComponent<MeshFilter>();
                if (filter != null) filter.sharedMesh = capSphere;
            }
        }

        private static void AddJointCap(GameObject actorRoot, string boneName, float diameter, Material mat, Mesh capSphere)
        {
            var bone = FindDeep(actorRoot.transform, boneName);
            if (bone == null) return; // fail closed: never throws if CCTV's bone names ever change
            var go = new GameObject("JointCap");
            go.transform.SetParent(bone, false);
            go.transform.localPosition = Vector3.zero;
            go.transform.localScale = new Vector3(diameter, diameter, diameter);
            go.AddComponent<MeshFilter>().sharedMesh = capSphere;
            var renderer = go.AddComponent<MeshRenderer>();
            if (mat != null) renderer.sharedMaterial = mat;
        }

        /// <summary>Tags every renderer that is a direct visual child of a bone with its value band. The order of the
        /// bands (torso anchor, then pelvis, arms/legs, hands, head lightening) is what makes head / torso / arms /
        /// pelvis-legs distinguishable at player distance without relying on outlines.</summary>
        private static void TagMaterialBands(GameObject actorRoot)
        {
            TagBone(actorRoot, "Head", ReconstructionMaterialBand.Head);
            TagBone(actorRoot, "Neck", ReconstructionMaterialBand.Head);
            TagBone(actorRoot, "Chest", ReconstructionMaterialBand.Torso);
            TagBone(actorRoot, "Spine", ReconstructionMaterialBand.Torso);
            TagBone(actorRoot, "Hips", ReconstructionMaterialBand.Pelvis);
            foreach (var side in new[] { "Left", "Right" })
            {
                TagBone(actorRoot, $"{side}UpperArm", ReconstructionMaterialBand.Limb);
                TagBone(actorRoot, $"{side}LowerArm", ReconstructionMaterialBand.Limb);
                TagBone(actorRoot, $"{side}Hand", ReconstructionMaterialBand.Hand);
                TagBone(actorRoot, $"{side}UpperLeg", ReconstructionMaterialBand.Limb, ReconstructionMaterialBand.Joint);
                TagBone(actorRoot, $"{side}LowerLeg", ReconstructionMaterialBand.Limb);
                TagBone(actorRoot, $"{side}Foot", ReconstructionMaterialBand.Limb);
            }
        }

        private static void TagBone(GameObject actorRoot, string boneName, ReconstructionMaterialBand band, ReconstructionMaterialBand? capBand = null)
        {
            var bone = FindDeep(actorRoot.transform, boneName);
            if (bone == null) return; // fail closed: never throws if CCTV's bone names ever change
            foreach (var renderer in bone.GetComponentsInChildren<Renderer>())
            {
                // Only direct visual children of this bone; a CHILD bone's renderers are tagged when its own name runs.
                if (renderer.transform.parent != bone) continue;
                var group = renderer.gameObject.GetComponent<ReconstructionMaterialGroup>() ?? renderer.gameObject.AddComponent<ReconstructionMaterialGroup>();
                // A cap sits between two segments, so it takes the blended band when one is given (the hip cap between
                // the pelvis and the thigh); otherwise it simply shares its segment's band.
                group.band = capBand.HasValue && renderer.name == "JointCap" ? capBand.Value : band;
            }
        }

        /// <summary>Reuses whatever material CCTV's own builder already applied to the actor (found on the first
        /// visual) rather than creating a second material asset; `ApplyGenericAppearance` later instances a per-renderer
        /// material with the banded tint.</summary>
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
