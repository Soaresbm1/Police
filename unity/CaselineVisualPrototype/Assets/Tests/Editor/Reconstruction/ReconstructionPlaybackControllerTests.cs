using System.Collections.Generic;
using NUnit.Framework;
using UnityEngine;

namespace Caseline.Reconstruction.Tests
{
    public class ReconstructionPlaybackControllerTests
    {
        private GameObject root;
        private ReconstructionPlaybackController playback;

        [SetUp]
        public void SetUp()
        {
            root = new GameObject("PlaybackTestRoot");
            var scene = root.AddComponent<ReconstructionSceneController>();
            playback = root.AddComponent<ReconstructionPlaybackController>();
            playback.Configure(scene);
            playback.Load(new ReconstructionScenarioData
            {
                version = 1,
                caseId = "playback-test",
                environment = "generic",
                durationSeconds = 100f,
                actors = new List<ReconstructionActorData>(),
                events = new List<ReconstructionEventData>(),
            });
        }

        [TearDown]
        public void TearDown() => Object.DestroyImmediate(root);

        [Test]
        public void PlayingFromExactlyAHoldPoint_StopsThereAgainImmediately()
        {
            playback.SetHoldPoints(new[] { 30f });
            playback.Seek(30f);
            var holds = 0;
            playback.HoldReached += _ => holds++;

            playback.Play();
            playback.Advance(1f);

            Assert.AreEqual(30f, playback.CurrentTime);
            Assert.AreEqual(1, holds);
        }

        [Test]
        public void SeekingPastAHold_ThenPlaying_DoesNotStopAtIt()
        {
            playback.SetHoldPoints(new[] { 30f });
            playback.Seek(60f);
            playback.Play();
            playback.Advance(10f);
            Assert.AreEqual(70f, playback.CurrentTime);
            Assert.IsTrue(playback.IsPlaying);
        }

        [Test]
        public void HoldPointsBeyondTheDuration_AreIgnored()
        {
            playback.SetHoldPoints(new[] { 150f });
            playback.Play();
            playback.Advance(500f);
            Assert.AreEqual(100f, playback.CurrentTime);
        }

        [Test]
        public void Load_ClearsHoldPointsFromThePreviousScenario()
        {
            playback.SetHoldPoints(new[] { 10f });
            playback.Load(new ReconstructionScenarioData
            {
                version = 1,
                caseId = "second",
                environment = "generic",
                durationSeconds = 100f,
                actors = new List<ReconstructionActorData>(),
                events = new List<ReconstructionEventData>(),
            });
            playback.Play();
            playback.Advance(20f);
            Assert.AreEqual(20f, playback.CurrentTime);
        }

        [Test]
        public void PlayingChanged_FiresOnlyOnRealTransitions()
        {
            var changes = new List<bool>();
            playback.PlayingChanged += changes.Add;
            playback.Play();
            playback.Play();
            playback.Pause();
            playback.Pause();
            CollectionAssert.AreEqual(new[] { true, false }, changes);
        }

        [Test]
        public void Speed_ScalesTruthTimeAdvance()
        {
            playback.SetSpeed(2f);
            playback.Play();
            playback.Advance(5f);
            Assert.AreEqual(10f, playback.CurrentTime);
        }
    }
}
