using Caseline.CCTVEditor;
using Caseline.ReconstructionEditor;
using NUnit.Framework;
using UnityEngine;

namespace Caseline.Reconstruction.Tests
{
    /// <summary>
    /// U5.6 iteration 2 — proves the Reconstruction-only actor silhouette polish
    /// (<see cref="ReconstructionActorVisualPolish"/>) never touches CCTV's own actor, never renames/reparents a
    /// bone, never changes actor scale/height, and produces the same result every time (no per-role or random
    /// variation). Every test constructs a fresh actor via the exact same public
    /// <c>CCTVPrototypeBuilder.BuildActor()</c> Reconstruction itself calls — never a hand-rolled stand-in.
    /// </summary>
    public class ReconstructionActorVisualPolishTests
    {
        private static readonly string[] BoneNames =
        {
            "Hips", "Spine", "Chest", "Neck", "Head",
            "LeftUpperArm", "LeftLowerArm", "LeftHand", "RightUpperArm", "RightLowerArm", "RightHand",
            "LeftUpperLeg", "LeftLowerLeg", "LeftFoot", "RightUpperLeg", "RightLowerLeg", "RightFoot",
        };

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

        private static float WorldHeadTopY(GameObject actor)
        {
            var head = FindDeep(actor.transform, "Head");
            // Matches CCTVPrototypeBuilder's own head sphere: offset by its own radius on Y, scaled to 2x radius.
            var headVisual = head.Find("Visual");
            return head.position.y + headVisual.localPosition.y + headVisual.localScale.y / 2f;
        }

        [Test]
        public void CCTVActor_IsUnaffected_ByReconstructionPolishAppliedToADifferentInstance()
        {
            var cctvOnly = CCTVPrototypeBuilder.BuildActor();
            var reconstructionCopy = CCTVPrototypeBuilder.BuildActor();

            var cctvChildCountBefore = CountAllDescendants(cctvOnly);
            ReconstructionActorVisualPolish.Apply(reconstructionCopy);
            var cctvChildCountAfter = CountAllDescendants(cctvOnly);

            Assert.AreEqual(cctvChildCountBefore, cctvChildCountAfter, "polishing one actor instance must never affect a separately-built CCTV actor instance");
            Assert.Greater(CountAllDescendants(reconstructionCopy), cctvChildCountAfter, "the polished instance should have gained new children");

            Object.DestroyImmediate(cctvOnly);
            Object.DestroyImmediate(reconstructionCopy);
        }

        private static int CountAllDescendants(GameObject go)
        {
            var count = 0;
            void Walk(Transform t)
            {
                count++;
                for (var i = 0; i < t.childCount; i++) Walk(t.GetChild(i));
            }
            Walk(go.transform);
            return count;
        }

        [Test]
        public void EveryOriginalBone_StillExists_WithItsOriginalName_AfterPolish()
        {
            var actor = CCTVPrototypeBuilder.BuildActor();
            ReconstructionActorVisualPolish.Apply(actor);

            foreach (var boneName in BoneNames)
            {
                Assert.IsNotNull(FindDeep(actor.transform, boneName), $"bone '{boneName}' must still exist by its original name after polish — Animator curve paths address bones by name/hierarchy path");
            }

            Object.DestroyImmediate(actor);
        }

        [Test]
        public void PolishNeverMoves_OrRescalesAnyOriginalBone()
        {
            var actor = CCTVPrototypeBuilder.BuildActor();
            var before = new System.Collections.Generic.Dictionary<string, (Vector3 pos, Quaternion rot, Vector3 scale)>();
            foreach (var name in BoneNames)
            {
                var t = FindDeep(actor.transform, name);
                before[name] = (t.localPosition, t.localRotation, t.localScale);
            }

            ReconstructionActorVisualPolish.Apply(actor);

            foreach (var name in BoneNames)
            {
                var t = FindDeep(actor.transform, name);
                var (pos, rot, scale) = before[name];
                Assert.AreEqual(pos, t.localPosition, $"{name} localPosition must be unchanged");
                Assert.AreEqual(rot, t.localRotation, $"{name} localRotation must be unchanged");
                Assert.AreEqual(scale, t.localScale, $"{name} localScale must be unchanged");
            }

            Object.DestroyImmediate(actor);
        }

        [Test]
        public void ActorTotalHeight_IsUnchangedByPolish()
        {
            var before = CCTVPrototypeBuilder.BuildActor();
            var beforeHeight = WorldHeadTopY(before);

            var after = CCTVPrototypeBuilder.BuildActor();
            ReconstructionActorVisualPolish.Apply(after);
            var afterHeight = WorldHeadTopY(after);

            Assert.AreEqual(beforeHeight, afterHeight, 0.0001f, "the new visual layer must never solve readability by changing actor height/scale");

            Object.DestroyImmediate(before);
            Object.DestroyImmediate(after);
        }

        [Test]
        public void NewJointCaps_ExistOnExpectedBones_WithNonNullMaterial()
        {
            var actor = CCTVPrototypeBuilder.BuildActor();
            ReconstructionActorVisualPolish.Apply(actor);

            // Iteration 4 keeps only the caps that show at player distance (hip, elbow, knee); wrist/ankle caps and the
            // waist/chest blend boxes were invisible micro-geometry and were removed in favour of the tapered forms.
            var jointBones = new[] { "LeftUpperLeg", "RightUpperLeg", "LeftLowerArm", "RightLowerArm", "LeftLowerLeg", "RightLowerLeg" };
            foreach (var boneName in jointBones)
            {
                var bone = FindDeep(actor.transform, boneName);
                var cap = bone.Find("JointCap");
                Assert.IsNotNull(cap, $"{boneName} should have a JointCap child");
                Assert.IsNotNull(cap.GetComponent<MeshRenderer>().sharedMaterial, $"{boneName}'s JointCap must have a material assigned");
                Assert.IsNull(cap.GetComponent<Collider>(), "no collider should exist on visual-only children");
            }
            Assert.IsNull(FindDeep(actor.transform, "LeftHand").Find("JointCap"), "the wrist cap was invisible micro-geometry");
            Assert.IsNull(FindDeep(actor.transform, "Spine").Find("WaistBlend"), "the waist blend is replaced by the continuous tapered torso/pelvis");

            Object.DestroyImmediate(actor);
        }

        [Test]
        public void Polish_IsDeterministic_IdenticalDimensionsAcrossSeparateActorInstances()
        {
            var a = CCTVPrototypeBuilder.BuildActor();
            var b = CCTVPrototypeBuilder.BuildActor();
            ReconstructionActorVisualPolish.Apply(a);
            ReconstructionActorVisualPolish.Apply(b);

            foreach (var boneName in new[] { "LeftUpperLeg", "LeftLowerArm", "LeftLowerLeg" })
            {
                var capA = FindDeep(a.transform, boneName).Find("JointCap");
                var capB = FindDeep(b.transform, boneName).Find("JointCap");
                Assert.AreEqual(capA.localScale, capB.localScale, $"{boneName} joint cap size must be identical across instances — no randomness, no per-instance variation");
            }

            Object.DestroyImmediate(a);
            Object.DestroyImmediate(b);
        }

        [Test]
        public void GroundContact_FootVisualBottom_IsMeasuredAndWithinToleranceOfTheFloor()
        {
            // U5.6 iteration 2, item 20 — deterministic audit, not a fix: CCTV's own rig (HipsHeight=0.92,
            // UpperLeg=0.46, LowerLeg=0.42) places the Foot bone at y=0.04, and its own foot visual (offset
            // y=-0.03, height 0.06) spans y=-0.02..0.04 in standing idle — a ~2cm overlap into the floor plane
            // that predates this iteration and belongs to CCTVPrototypeBuilder, not anything added here. Recorded
            // as a regression guard (this file adds no new geometry below the foot) and an honest limitation for
            // the report, not something this iteration changes — fixing it would mean touching CCTV's own bone
            // height/visual constants, which iteration 2 is explicitly not authorized to do.
            var actor = CCTVPrototypeBuilder.BuildActor();
            var foot = FindDeep(actor.transform, "LeftFoot");
            var footVisual = foot.Find("Visual");
            var bottomWorldY = foot.position.y + footVisual.localPosition.y - footVisual.localScale.y / 2f;

            Assert.Less(Mathf.Abs(bottomWorldY), 0.05f, "pre-existing CCTV foot/floor overlap must stay small (not 'deep' penetration) — currently ~2cm, unrelated to this iteration's own additions");

            Object.DestroyImmediate(actor);
        }

        [Test]
        public void Polish_NeverThrows_IfCalledTwiceOnTheSameActor()
        {
            // Defensive: confirms the fail-closed FindDeep-returns-null guard never crashes even in an
            // unanticipated double-apply, and simply adds a second set of children rather than erroring.
            var actor = CCTVPrototypeBuilder.BuildActor();
            Assert.DoesNotThrow(() => ReconstructionActorVisualPolish.Apply(actor));
            Assert.DoesNotThrow(() => ReconstructionActorVisualPolish.Apply(actor));
            Object.DestroyImmediate(actor);
        }

        // ---- U5.6 iteration 4 - large-form redesign (tapered torso/pelvis/limbs, faceted head, value ladder) ----

        private static Bounds VisualBounds(Transform visual)
        {
            var mesh = visual.GetComponent<MeshFilter>().sharedMesh;
            var b = mesh.bounds;
            var s = visual.localScale;
            return new Bounds(Vector3.Scale(b.center, s), Vector3.Scale(b.size, s));
        }

        /// <summary>Full width (X) of the visual at its bottom or top face, in the visual's parent-space scale.</summary>
        private static float FaceWidth(Transform visual, bool top)
        {
            var mesh = visual.GetComponent<MeshFilter>().sharedMesh;
            var yLimit = top ? mesh.bounds.max.y : mesh.bounds.min.y;
            float maxX = 0f;
            foreach (var v in mesh.vertices)
            {
                if (Mathf.Abs(v.y - yLimit) < 1e-4f) maxX = Mathf.Max(maxX, Mathf.Abs(v.x));
            }
            return maxX * 2f * visual.localScale.x;
        }

        private static Transform VisualOf(GameObject actor, string bone) => FindDeep(actor.transform, bone).Find("Visual");

        private static GameObject PolishedActor()
        {
            var actor = CCTVPrototypeBuilder.BuildActor();
            ReconstructionActorVisualPolish.Apply(actor);
            return actor;
        }

        [Test]
        public void Torso_TapersFromWideShouldersToNarrowWaist()
        {
            var actor = PolishedActor();
            var torso = VisualOf(actor, "Chest");
            var shoulders = FaceWidth(torso, true);
            var waist = FaceWidth(torso, false);

            Assert.GreaterOrEqual(shoulders - waist, 0.12f, "shoulders must be clearly wider than the waist (visible at player distance)");
            Assert.AreEqual(0.40f, shoulders, 0.01f);
            Object.DestroyImmediate(actor);
        }

        [Test]
        public void Pelvis_FlaresBelowTheWaist_AndOverlapsTheTorsoBottom()
        {
            var actor = PolishedActor();
            var pelvis = VisualOf(actor, "Hips");
            var torso = VisualOf(actor, "Chest");

            Assert.Greater(FaceWidth(pelvis, false), FaceWidth(torso, false) + 0.03f, "pelvis must be slightly wider again than the waist");
            Assert.AreEqual(FaceWidth(torso, false), FaceWidth(pelvis, true), 0.01f, "pelvis top and torso bottom share the waist width");

            var pelvisTopY = pelvis.TransformPoint(pelvis.GetComponent<MeshFilter>().sharedMesh.bounds.max).y;
            var torsoBottomY = torso.TransformPoint(torso.GetComponent<MeshFilter>().sharedMesh.bounds.min).y;
            Assert.GreaterOrEqual(pelvisTopY, torsoBottomY - 0.001f, "no vertical gap between pelvis and torso");
            Object.DestroyImmediate(actor);
        }

        [Test]
        public void Pelvis_ConnectsToBothThighs_ThroughHipCaps()
        {
            var actor = PolishedActor();
            var pelvisWidth = FaceWidth(VisualOf(actor, "Hips"), false);
            foreach (var side in new[] { "Left", "Right" })
            {
                var cap = FindDeep(actor.transform, $"{side}UpperLeg").Find("JointCap");
                Assert.IsNotNull(cap);
                Assert.Greater(cap.localScale.x, FaceWidth(VisualOf(actor, $"{side}UpperLeg"), true) * 0.9f, "hip cap must bridge the thigh top");
                Assert.LessOrEqual(cap.localScale.x, pelvisWidth, "hip cap must not exceed the pelvis");
            }
            Object.DestroyImmediate(actor);
        }

        [Test]
        public void Arms_TaperFromThickUpperArmToSlimForearm()
        {
            var actor = PolishedActor();
            foreach (var side in new[] { "Left", "Right" })
            {
                var upper = VisualOf(actor, $"{side}UpperArm");
                var fore = VisualOf(actor, $"{side}LowerArm");
                Assert.GreaterOrEqual(FaceWidth(upper, true) - FaceWidth(upper, false), 0.03f, "upper arm must taper visibly");
                Assert.Less(FaceWidth(fore, false), FaceWidth(fore, true), "forearm narrows toward the wrist");
                Assert.LessOrEqual(FaceWidth(fore, true), FaceWidth(upper, false) + 0.005f, "forearm starts where the upper arm ends");
                Assert.Less(FaceWidth(upper, true), 0.13f, "arms must not become bulky");
            }
            Object.DestroyImmediate(actor);
        }

        [Test]
        public void Legs_TaperThighToCalfToNarrowAnkle_AndStaySeparate()
        {
            var actor = PolishedActor();
            var thigh = VisualOf(actor, "LeftUpperLeg");
            var calf = VisualOf(actor, "LeftLowerLeg");
            Assert.Greater(FaceWidth(thigh, true), FaceWidth(thigh, false), "thigh tapers toward the knee");
            Assert.Greater(FaceWidth(thigh, true), FaceWidth(calf, true) + 0.03f, "thigh clearly stronger than calf");
            Assert.Less(FaceWidth(calf, false), FaceWidth(calf, true) - 0.03f, "calf tapers toward a narrow ankle");

            var leftX = FindDeep(actor.transform, "LeftUpperLeg").position.x;
            var rightX = FindDeep(actor.transform, "RightUpperLeg").position.x;
            Assert.Greater(Mathf.Abs(leftX - rightX), FaceWidth(thigh, true) * 1.05f, "legs must not merge into one block");
            Object.DestroyImmediate(actor);
        }

        [Test]
        public void Head_IsNeutralFacetedMannequinHead_SameHeightNoFeatures()
        {
            var actor = PolishedActor();
            var headBone = FindDeep(actor.transform, "Head");
            Assert.AreEqual(1, headBone.childCount, "head has exactly one visual child - no face, hair or accessory pieces");
            Assert.AreEqual(1, headBone.GetComponentsInChildren<Renderer>().Length);

            var visual = headBone.Find("Visual");
            Assert.AreEqual(0.24f, visual.localScale.y, 0.0001f, "head height (and so total actor height) is unchanged");
            Assert.Less(visual.localScale.x, visual.localScale.y, "head is an egg shape, not a ball");
            var tris = visual.GetComponent<MeshFilter>().sharedMesh.triangles.Length / 3;
            Assert.Less(tris, 200, "low-poly faceted head, not the 768-triangle Unity sphere");
            Object.DestroyImmediate(actor);
        }

        [Test]
        public void ValueLadder_IsMonotone_TorsoDarkestAnchorToHeadLightest_ForEveryAppearance()
        {
            foreach (var appearance in new[] { "workwear_dark", "casual_neutral", "smart_light" })
            {
                var tint = ReconstructionAppearanceUtil.ToneTint(appearance);
                float L(ReconstructionMaterialBand band) => ReconstructionEnvironmentPalette.Luminance(ReconstructionMaterialGroup.BandTint(tint, band));
                var ladder = new[]
                {
                    L(ReconstructionMaterialBand.Torso), L(ReconstructionMaterialBand.Pelvis), L(ReconstructionMaterialBand.Joint),
                    L(ReconstructionMaterialBand.Limb), L(ReconstructionMaterialBand.Hand), L(ReconstructionMaterialBand.Head),
                };
                for (var i = 1; i < ladder.Length; i++) Assert.Greater(ladder[i], ladder[i - 1], $"{appearance}: band {i} must be lighter than band {i - 1}");
                Assert.GreaterOrEqual(ladder[5] - ladder[0], 0.12f, $"{appearance}: head vs torso must differ enough to survive player distance");
                Assert.GreaterOrEqual(ladder[3] - ladder[0], 0.04f, $"{appearance}: arms/legs must separate from the torso");
            }
        }

        [Test]
        public void ValueLadder_IsDeterministic_AndOnlyReadsTheGenericAppearanceTint()
        {
            var tint = ReconstructionAppearanceUtil.ToneTint("workwear_dark");
            Assert.AreEqual(ReconstructionMaterialGroup.BandTint(tint, ReconstructionMaterialBand.Limb), ReconstructionMaterialGroup.BandTint(tint, ReconstructionMaterialBand.Limb));
            Assert.AreEqual(tint.a, ReconstructionMaterialGroup.BandTint(tint, ReconstructionMaterialBand.Head).a);
            // Same genericAppearance -> same materials, whatever the role: BandTint's only inputs are the tint and the band.
            var a = ReconstructionMaterialGroup.BandTint(ReconstructionAppearanceUtil.ToneTint("x_dark"), ReconstructionMaterialBand.Torso);
            var b = ReconstructionMaterialGroup.BandTint(ReconstructionAppearanceUtil.ToneTint("y_dark"), ReconstructionMaterialBand.Torso);
            Assert.AreEqual(a, b, "the category prefix and any identity-shaped value never reach the material");
        }

        [Test]
        public void MaterialBands_AreAssigned_ToHeadPelvisTorsoLimbsAndHands()
        {
            var actor = PolishedActor();
            ReconstructionMaterialBand Band(string bone) => VisualOf(actor, bone).GetComponent<ReconstructionMaterialGroup>().band;
            Assert.AreEqual(ReconstructionMaterialBand.Head, Band("Head"));
            Assert.AreEqual(ReconstructionMaterialBand.Torso, Band("Chest"));
            Assert.AreEqual(ReconstructionMaterialBand.Pelvis, Band("Hips"));
            Assert.AreEqual(ReconstructionMaterialBand.Limb, Band("LeftUpperArm"));
            Assert.AreEqual(ReconstructionMaterialBand.Limb, Band("RightLowerLeg"));
            Assert.AreEqual(ReconstructionMaterialBand.Hand, Band("LeftHand"));
            Assert.AreEqual(ReconstructionMaterialBand.Joint, FindDeep(actor.transform, "LeftUpperLeg").Find("JointCap").GetComponent<ReconstructionMaterialGroup>().band);
            Object.DestroyImmediate(actor);
        }

        [Test]
        public void MaterialBandAssignment_IsIdenticalAcrossActorInstances_RoleIndependent()
        {
            var a = PolishedActor();
            var b = PolishedActor();
            foreach (var bone in BoneNames)
            {
                var nodeA = FindDeep(a.transform, bone).Find("Visual");
                var nodeB = FindDeep(b.transform, bone).Find("Visual");
                if (nodeA == null || nodeB == null) continue; // Spine has no visual of its own
                Assert.AreEqual(nodeA.GetComponent<ReconstructionMaterialGroup>().band, nodeB.GetComponent<ReconstructionMaterialGroup>().band, bone);
            }
            Object.DestroyImmediate(a);
            Object.DestroyImmediate(b);
        }

        [Test]
        public void CCTVActor_NeverGainsMaterialGroupOrReconstructionMeshes()
        {
            var cctvOnly = CCTVPrototypeBuilder.BuildActor();
            var reconstructionCopy = PolishedActor();

            foreach (var bone in BoneNames)
            {
                var visual = FindDeep(cctvOnly.transform, bone).Find("Visual");
                if (visual == null) continue; // Spine has no visual of its own
                Assert.IsNull(visual.GetComponent<ReconstructionMaterialGroup>(), bone);
                StringAssert.DoesNotContain("Recon_", visual.GetComponent<MeshFilter>().sharedMesh.name, bone);
            }
            Assert.IsNotNull(VisualOf(reconstructionCopy, "Chest").GetComponent<ReconstructionMaterialGroup>());
            Object.DestroyImmediate(cctvOnly);
            Object.DestroyImmediate(reconstructionCopy);
        }

        [Test]
        public void GeometryBudget_StaysLightweight_AndIsReported()
        {
            var baseline = CCTVPrototypeBuilder.BuildActor();
            var polished = PolishedActor();

            (int renderers, int tris) Count(GameObject go)
            {
                var r = 0;
                var t = 0;
                foreach (var f in go.GetComponentsInChildren<MeshFilter>())
                {
                    r++;
                    t += f.sharedMesh.triangles.Length / 3;
                }
                return (r, t);
            }

            var before = Count(baseline);
            var after = Count(polished);
            Debug.Log($"[U5.6 iter4 budget] CCTV rig visuals={before.renderers} tris={before.tris} | Reconstruction mannequin visuals={after.renderers} tris={after.tris}");
            Assert.LessOrEqual(after.renderers, 26, "few meaningful forms, not many primitives");
            Assert.LessOrEqual(after.tris, 1400, "lightweight for WebGL");
            Object.DestroyImmediate(baseline);
            Object.DestroyImmediate(polished);
        }

        [Test]
        public void EnvironmentPalette_SeparatesFloorWallAndProps_ByValueAndHue_AndFromTheActors()
        {
            var floor = ReconstructionEnvironmentPalette.Floor;
            var wall = ReconstructionEnvironmentPalette.Wall;
            var prop = ReconstructionEnvironmentPalette.Prop;
            float L(Color c) => ReconstructionEnvironmentPalette.Luminance(c);

            Assert.GreaterOrEqual(Mathf.Abs(L(floor) - L(wall)), 0.015f, "floor and wall must not be the same grey");
            Assert.Greater(floor.b, floor.r, "floor is a cool grey");
            Assert.Greater(wall.r, wall.b, "walls are a warm grey");
            Assert.GreaterOrEqual(L(prop) - L(wall), 0.08f, "architectural props must read lighter than the walls");

            foreach (var appearance in new[] { "workwear_dark", "casual_neutral", "smart_light" })
            {
                var torso = ReconstructionMaterialGroup.BandTint(ReconstructionAppearanceUtil.ToneTint(appearance), ReconstructionMaterialBand.Torso);
                // Worst case is the lightest appearance against the lightest surface; report every pairing.
                Debug.Log($"[U5.6 iter4 contrast] {appearance}: torso L={L(torso):F3} floor L={L(floor):F3} wall L={L(wall):F3} prop L={L(prop):F3}");
            }
            var neutralTorso = ReconstructionMaterialGroup.BandTint(ReconstructionAppearanceUtil.ToneTint("casual_neutral"), ReconstructionMaterialBand.Torso);
            Assert.GreaterOrEqual(L(floor) - L(neutralTorso), 0.08f, "the default mannequin must stand out from the floor");
        }

        [Test]
        public void EnvironmentPalette_IsDeterministicConstants_NoPerCaseVariation()
        {
            Assert.AreEqual(ReconstructionEnvironmentPalette.Floor, ReconstructionEnvironmentPalette.Floor);
            Assert.AreEqual(0.27f, ReconstructionEnvironmentPalette.Floor.r, 0.0001f);
            Assert.AreEqual(ReconstructionEnvironmentPalette.Luminance(ReconstructionEnvironmentPalette.Wall), ReconstructionEnvironmentPalette.Luminance(ReconstructionEnvironmentPalette.Wall));
        }
    }
}
