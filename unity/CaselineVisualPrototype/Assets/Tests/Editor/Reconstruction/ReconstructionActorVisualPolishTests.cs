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

            var jointBones = new[] { "LeftUpperLeg", "RightUpperLeg", "LeftLowerArm", "RightLowerArm", "LeftHand", "RightHand", "LeftLowerLeg", "RightLowerLeg", "LeftFoot", "RightFoot" };
            foreach (var boneName in jointBones)
            {
                var bone = FindDeep(actor.transform, boneName);
                var cap = bone.Find("JointCap");
                Assert.IsNotNull(cap, $"{boneName} should have a new JointCap child");
                Assert.IsNotNull(cap.GetComponent<MeshRenderer>().sharedMaterial, $"{boneName}'s JointCap must have a material assigned");
                Assert.IsNull(cap.GetComponent<Collider>(), "no collider should survive on WebGL-unsafe primitive children");
            }

            var spine = FindDeep(actor.transform, "Spine");
            Assert.IsNotNull(spine.Find("WaistBlend"), "Spine should gain a new WaistBlend child");

            Object.DestroyImmediate(actor);
        }

        [Test]
        public void Polish_IsDeterministic_IdenticalDimensionsAcrossSeparateActorInstances()
        {
            var a = CCTVPrototypeBuilder.BuildActor();
            var b = CCTVPrototypeBuilder.BuildActor();
            ReconstructionActorVisualPolish.Apply(a);
            ReconstructionActorVisualPolish.Apply(b);

            foreach (var boneName in new[] { "LeftUpperLeg", "LeftLowerArm", "LeftHand", "LeftLowerLeg", "LeftFoot" })
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
    }
}
