using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Caseline.Reconstruction.Tests
{
    /// <summary>
    /// The optional character kit. The table tests run everywhere; the actor tests need the locally installed kit and are
    /// skipped (Assume) on a clone that does not have it.
    /// </summary>
    public class ReconstructionActorKitTests
    {
        private const string RightArm = "Model/Root/Hips/Spine_01/Spine_02/Spine_03/Clavicle_R/Shoulder_R";
        private const string RightHand = RightArm + "/Elbow_R/Hand_R";
        private const string Hips = "Model/Root/Hips";
        private static readonly string[] Categories = { "casual", "formal", "workwear", "outerwear" };
        private static readonly string[] Tones = { "dark", "light", "neutral" };

        private readonly List<GameObject> _created = new();

        [TearDown]
        public void TearDown()
        {
            foreach (var go in _created) if (go != null) Object.DestroyImmediate(go);
            _created.Clear();
        }

        private GameObject Actor(string appearance = "formal_light")
        {
            Assume.That(ReconstructionActorKit.IsAvailable, "the character kit is not installed on this machine");
            var go = ReconstructionActorKit.TryCreate(appearance, null);
            Assert.IsNotNull(go, appearance);
            _created.Add(go);
            return go;
        }

        private static void Pose(GameObject actor, string state, float normalizedTime)
        {
            var animator = actor.GetComponent<Animator>();
            animator.Play(state, 0, normalizedTime);
            animator.speed = 0f;
            animator.Update(0f);
        }

        // ---- data: runs everywhere ----

        [Test]
        public void EveryAppearance_MapsToOneOfTwelveDistinctOfficeWorkers_AndUnknownOnesFallBackToTheMannequin()
        {
            var names = new HashSet<string>();
            foreach (var category in Categories)
            {
                foreach (var tone in Tones)
                {
                    var character = ReconstructionActorKit.CharacterFor($"{category}_{tone}");
                    Assert.IsNotNull(character, $"{category}_{tone}");
                    names.Add(character);
                }
            }
            Assert.AreEqual(12, names.Count, "every clothing category and tone gets its own character");
            foreach (var name in names)
            {
                foreach (var word in new[] { "Security", "Cleaner", "Boss" }) StringAssert.DoesNotContain(word, name, "no outfit that says something about who the person is");
            }
            foreach (var unknown in new[] { null, "", "casual", "casual_", "robe_dark", "formal_green", "default", "_dark" })
            {
                Assert.IsNull(ReconstructionActorKit.CharacterFor(unknown), unknown ?? "null");
            }
        }

        [Test]
        public void TheChoiceTakesOnlyTheGenericAppearance_NeverARoleVisualIdOrAnythingAboutThePerson()
        {
            var method = typeof(ReconstructionActorKit).GetMethod(nameof(ReconstructionActorKit.CharacterFor));
            var parameters = method.GetParameters();
            Assert.AreEqual(1, parameters.Length);
            Assert.AreEqual(typeof(string), parameters[0].ParameterType);
            Assert.AreEqual("genericAppearance", parameters[0].Name);
        }

        // ---- the installed kit ----

        [Test]
        public void KitActor_IsOneSkinnedMeshWithNoCollidersOrLights_AndStandsOnTheFloorAtTheMannequinsHeight()
        {
            var actor = Actor();
            Assert.AreEqual(1, actor.GetComponentsInChildren<SkinnedMeshRenderer>(true).Length, "only its own mesh, not the pack's 18 disabled siblings");
            Assert.AreEqual(0, actor.GetComponentsInChildren<Collider>(true).Length);
            Assert.AreEqual(0, actor.GetComponentsInChildren<Light>(true).Length);
            Assert.IsNotNull(actor.GetComponent<ReconstructionKitActor>());
            Assert.IsNotNull(actor.GetComponent<ReconstructionActorController>());

            Pose(actor, "Idle", 0f);
            var smr = actor.GetComponentInChildren<SkinnedMeshRenderer>();
            // Measured on the real skinned vertices in the standing pose, in the actor's own space (feet at y = 0).
            var mesh = new Mesh();
            smr.BakeMesh(mesh, true);
            var toActor = actor.transform.worldToLocalMatrix * smr.transform.localToWorldMatrix;
            var ys = mesh.vertices.Select(v => toActor.MultiplyPoint3x4(v).y).ToList();
            Object.DestroyImmediate(mesh);
            Assert.AreEqual(ReconstructionFramingMeasurement.ActorHeightMeters, ys.Max(), 0.12f, "framing measurements assume the mannequin's height (the arm-drop and hair add a little)");
            Assert.AreEqual(0f, ys.Min(), 0.05f, "feet on the floor");
        }

        [Test]
        public void KitActor_IdleLetsTheArmsHangAtTheSides_NotInTheModelsTPose()
        {
            var actor = Actor();
            Pose(actor, "Idle", 0f);
            var shoulder = actor.transform.Find(RightArm);
            var hand = actor.transform.Find(RightHand);
            Assert.IsNotNull(hand);
            Assert.Less(hand.position.y, shoulder.position.y - 0.4f, "the hand hangs well below the shoulder");
            Assert.Less(Mathf.Abs(hand.position.x - shoulder.position.x), 0.45f, "and close to the body, not out to the side");
        }

        [Test]
        public void KitActor_PlaysTheBakedClips_StrikeRaisesTheArm_WalkSwingsTheLegs_CollapseLaysTheBodyDown()
        {
            var actor = Actor();
            var hips = actor.transform.Find(Hips);
            var hand = actor.transform.Find(RightHand);
            var leg = actor.transform.Find("Model/Root/Hips/UpperLeg_L/LowerLeg_L/Ankle_L");

            Pose(actor, "Idle", 0f);
            var idleHand = hand.position;
            var idleFoot = leg.position;
            var idleHipsY = hips.position.y;

            Pose(actor, "AttackStrike", 0.25f);
            Assert.Greater(Vector3.Distance(idleHand, hand.position), 0.3f, "the striking hand moves");
            Assert.Greater(hand.position.z - idleHand.z, 0.2f, "forward, toward the other person");

            Pose(actor, "Walk", 0.25f);
            Assert.Greater(Vector3.Distance(idleFoot, leg.position), 0.1f, "a stride");

            Pose(actor, "Collapse", 1f);
            Assert.Less(hips.position.y, 0.35f, "the hips are on the floor");
            Assert.Less(idleHipsY - hips.position.y, 0.95f);
            Assert.Less(hand.position.y, 0.4f, "everything lies near the floor");

            Pose(actor, "ManipulateScene", 1f);
            Assert.Less(hips.position.y, idleHipsY - 0.1f, "a crouch");
        }

        [Test]
        public void KitActor_KeepsItsOwnLook_TheMannequinToneTintIsNotApplied()
        {
            var actor = Actor();
            var controller = actor.GetComponent<ReconstructionActorController>();
            var renderer = actor.GetComponentInChildren<SkinnedMeshRenderer>();
            var before = renderer.sharedMaterial.color;
            controller.Configure(new ReconstructionActorData { visualId = "a", roleForReconstruction = "culprit", genericAppearance = "formal_dark" }, new List<ReconstructionEventData>(), "corridor");
            Assert.AreEqual(before, renderer.sharedMaterial.color);
            Assert.AreEqual(Color.white, renderer.sharedMaterial.color);
        }

        [Test]
        public void Disabling_TheKit_BringsBackTheMannequin()
        {
            Assume.That(ReconstructionActorKit.IsAvailable, "the character kit is not installed on this machine");
            ReconstructionActorKit.Enabled = false;
            try
            {
                Assert.IsNull(ReconstructionActorKit.TryCreate("formal_light", null));
            }
            finally
            {
                ReconstructionActorKit.Enabled = true;
            }
        }
    }
}
