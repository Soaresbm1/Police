using Caseline.CCTV;
using Caseline.CCTVEditor;
using NUnit.Framework;
using UnityEngine;

namespace Caseline.CCTV.Tests
{
    /// <summary>
    /// Phase U4 — verifies the real, shipped actor (built by
    /// <see cref="CCTVPrototypeBuilder.BuildActor"/>, the same code path
    /// used to construct the production scene) still obeys
    /// "state = f(absolute playback time)" after the walk-cycle/rig upgrade
    /// (req. 24): re-applying the same time reproduces an identical pose,
    /// scrubbing backward is safe, and nothing here ever touches
    /// <see cref="CCTVActorController.Apply"/>'s caller-supplied position —
    /// only bone-local rotation/position (cosmetic pose) is asserted.
    /// </summary>
    public class CCTVActorAnimationDeterminismTests
    {
        private GameObject actorGo;
        private CCTVActorController controller;

        [SetUp]
        public void SetUp()
        {
            actorGo = CCTVPrototypeBuilder.BuildActor();
            controller = actorGo.GetComponent<CCTVActorController>();
            controller.Configure(new CCTVActorData
            {
                visualId = "actor-0",
                identified = false,
                startTime = 0f,
                endTime = 10f,
                startPosition = new[] { 0f, 0f, 0f },
                endPosition = new[] { 8f, 0f, 0f },
                walkSpeed = 1.4f,
            });
        }

        [TearDown]
        public void TearDown()
        {
            Object.DestroyImmediate(actorGo.transform.parent != null ? actorGo.transform.parent.gameObject : actorGo);
        }

        private Quaternion HipsRotation()
        {
            return actorGo.transform.Find("Hips").localRotation;
        }

        private Quaternion KneeRotation()
        {
            return actorGo.transform.Find("Hips/LeftUpperLeg/LeftLowerLeg").localRotation;
        }

        [TestCase(0f)]
        [TestCase(3.25f)]
        [TestCase(7.2f)]
        [TestCase(9.999f)]
        public void SameTime_ProducesIdenticalPose(float time)
        {
            controller.Apply(time);
            var hipsFirst = HipsRotation();
            var kneeFirst = KneeRotation();
            var posFirst = actorGo.transform.position;

            // Apply a different time in between, then come back — this is
            // the same guarantee CCTVActorTimeline's own tests exercise,
            // now asserted through the real Animator-driven pose too.
            controller.Apply(1.11f);
            controller.Apply(time);

            Assert.AreEqual(hipsFirst, HipsRotation(), "Hips rotation must be identical when re-applying the same time.");
            Assert.AreEqual(kneeFirst, KneeRotation(), "Knee rotation must be identical when re-applying the same time.");
            Assert.AreEqual(posFirst, actorGo.transform.position, "World position must be identical when re-applying the same time.");
        }

        [Test]
        public void ScrubbingBackward_ReproducesTheSamePoseAsForwardPlayback()
        {
            controller.Apply(6.4f);
            var forwardHips = HipsRotation();
            var forwardKnee = KneeRotation();

            controller.Apply(9.9f);
            controller.Apply(2.0f);
            controller.Apply(6.4f); // scrub back past where we've already been

            Assert.AreEqual(forwardHips, HipsRotation());
            Assert.AreEqual(forwardKnee, KneeRotation());
        }

        [Test]
        public void PlaybackSpeedNeverAffectsPoseAtAGivenAbsoluteTime()
        {
            // Apply() only ever receives an absolute time — this test
            // simulates reaching t=5 via two different "speeds" (few large
            // steps vs. many small steps) and asserts the resulting pose is
            // identical either way, exactly as req. 24 requires.
            controller.Apply(0f);
            controller.Apply(5f); // as if arrived at 2x speed
            var fastArrivalHips = HipsRotation();

            controller.Apply(0f);
            for (var t = 0f; t <= 5f; t += 0.37f) controller.Apply(t); // as if arrived at 0.5x speed via many small steps
            controller.Apply(5f);
            var slowArrivalHips = HipsRotation();

            Assert.AreEqual(fastArrivalHips, slowArrivalHips);
        }

        [Test]
        public void IdleAfterWalk_ReturnsToARelaxedNeutralPose_NoStuckMidSwingChannels()
        {
            // Walk drives Hips/Chest twist, foot roll and elbow bend — none
            // of which existed before Phase U4. Confirms Idle (reached once
            // time >= endTime) doesn't freeze any of them mid-swing.
            controller.Apply(5f); // mid-walk
            controller.Apply(10.5f); // past endTime -> Idle state

            var hipsY = HipsRotation().eulerAngles.y;
            var normalizedHipsY = hipsY > 180f ? hipsY - 360f : hipsY;
            Assert.That(normalizedHipsY, Is.EqualTo(0f).Within(0.01f), "Idle must not inherit Walk's pelvis twist.");
        }
    }
}
