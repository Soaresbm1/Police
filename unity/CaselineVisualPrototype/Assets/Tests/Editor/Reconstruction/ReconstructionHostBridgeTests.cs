using System.Collections.Generic;
using NUnit.Framework;
using UnityEngine;

namespace Caseline.Reconstruction.Tests
{
    public class ReconstructionHostBridgeTests
    {
        private const string ValidJson = @"{
            ""version"": 1,
            ""caseId"": ""case-123"",
            ""environment"": ""generic"",
            ""durationSeconds"": 100,
            ""actors"": [
                {
                    ""visualId"": ""actor_a"",
                    ""roleForReconstruction"": ""culprit"",
                    ""genericAppearance"": ""casual_dark"",
                    ""spawnTime"": 0,
                    ""despawnTime"": 100,
                    ""waypoints"": [{""time"": 0, ""slot"": ""interaction""}, {""time"": 50, ""slot"": ""crime_point""}]
                },
                {
                    ""visualId"": ""actor_b"",
                    ""roleForReconstruction"": ""victim"",
                    ""genericAppearance"": ""formal_light"",
                    ""spawnTime"": 0,
                    ""despawnTime"": 50,
                    ""waypoints"": [{""time"": 0, ""slot"": ""interaction""}]
                }
            ],
            ""events"": [
                {""time"": 0, ""type"": ""talk"", ""actorVisualId"": ""actor_a"", ""counterpartyVisualId"": ""actor_b"", ""locationSlot"": ""interaction""},
                {""time"": 50, ""type"": ""attack"", ""actorVisualId"": ""actor_a"", ""counterpartyVisualId"": ""actor_b"", ""locationSlot"": ""crime_point"", ""safeVisualAction"": ""attack_strike""}
            ]
        }";

        private sealed class RecordingNotifier : IReconstructionHostNotifier
        {
            public readonly List<(string Type, int Token, string Detail)> Events = new();

            public void Emit(string eventType, int token, string detail) => Events.Add((eventType, token, detail));

            public List<(string Type, int Token, string Detail)> OfType(string type) => Events.FindAll(e => e.Type == type);
        }

        private GameObject root;
        private ReconstructionPlaybackController playback;
        private ReconstructionWebBridge bridge;
        private RecordingNotifier notifier;

        [SetUp]
        public void SetUp()
        {
            root = new GameObject("BridgeTestRoot");
            var scene = root.AddComponent<ReconstructionSceneController>();
            playback = root.AddComponent<ReconstructionPlaybackController>();
            playback.Configure(scene);
            bridge = root.AddComponent<ReconstructionWebBridge>();
            bridge.Configure(playback);
            notifier = new RecordingNotifier();
            bridge.SetNotifier(notifier);
        }

        [TearDown]
        public void TearDown() => Object.DestroyImmediate(root);

        private void LoadAndReady(int token)
        {
            bridge.LoadScenario($"{token}:{ValidJson}");
            bridge.NotifyReadyIfCurrent(token);
        }

        [Test]
        public void Protocol_ParsesTokenAndPayload_EvenWhenThePayloadContainsColons()
        {
            Assert.IsTrue(ReconstructionHostProtocol.TryParseTokenAndPayload("42:{\"a\":1}", out var token, out var payload));
            Assert.AreEqual(42, token);
            Assert.AreEqual("{\"a\":1}", payload);

            Assert.IsTrue(ReconstructionHostProtocol.TryParseTokenAndPayload("7", out token, out payload));
            Assert.AreEqual(7, token);
            Assert.AreEqual(string.Empty, payload);
        }

        [Test]
        public void Protocol_RejectsMissingNegativeOrNonNumericTokens()
        {
            foreach (var message in new[] { "", ":payload", "-1:payload", "abc:payload", "1.5:payload", null })
            {
                Assert.IsFalse(ReconstructionHostProtocol.TryParseTokenAndPayload(message, out var token, out _), $"'{message}'");
                Assert.AreEqual(-1, token);
            }
        }

        [Test]
        public void ValidLoad_AppliesTheScenario_ButEmitsReadyOnlyWhenTheLoadCompletes_AndOnlyOnce()
        {
            bridge.LoadScenario("5:" + ValidJson);
            Assert.IsNotNull(playback.Scenario);
            Assert.AreEqual(0f, playback.CurrentTime);
            Assert.IsEmpty(notifier.OfType(ReconstructionHostEvents.Ready), "ready must wait for the frame after the scene is applied");

            bridge.NotifyReadyIfCurrent(5);
            bridge.NotifyReadyIfCurrent(5);

            var ready = notifier.OfType(ReconstructionHostEvents.Ready);
            Assert.AreEqual(1, ready.Count);
            Assert.AreEqual(5, ready[0].Token);
            Assert.AreEqual("100", ready[0].Detail);
        }

        [Test]
        public void InvalidScenario_EmitsLoadFailedWithANeutralCode_AndNeverReady()
        {
            bridge.LoadScenario("3:{\"version\":2,\"secret\":\"do-not-echo\"}");
            bridge.NotifyReadyIfCurrent(3);

            var failed = notifier.OfType(ReconstructionHostEvents.LoadFailed);
            Assert.AreEqual(1, failed.Count);
            Assert.AreEqual(3, failed[0].Token);
            Assert.AreEqual(ReconstructionWebBridge.InvalidScenario, failed[0].Detail);
            Assert.IsEmpty(notifier.OfType(ReconstructionHostEvents.Ready));
            StringAssert.DoesNotContain("do-not-echo", string.Join("|", notifier.Events));
        }

        [Test]
        public void MalformedCommand_EmitsLoadFailedWithoutAToken()
        {
            bridge.LoadScenario("not-a-token");
            var failed = notifier.OfType(ReconstructionHostEvents.LoadFailed);
            Assert.AreEqual(1, failed.Count);
            Assert.AreEqual(-1, failed[0].Token);
            Assert.AreEqual(ReconstructionWebBridge.MalformedCommand, failed[0].Detail);
        }

        [Test]
        public void CommandsArrivingBeforeReady_AreIgnored()
        {
            bridge.LoadScenario("1:" + ValidJson);
            bridge.Seek("1:40");
            bridge.Play("1");
            Assert.AreEqual(0f, playback.CurrentTime);
            Assert.IsFalse(playback.IsPlaying);
        }

        [Test]
        public void StaleSeekFromAPreviousLoad_NeverActsOnTheNewScenario()
        {
            LoadAndReady(1);
            bridge.LoadScenario("2:" + ValidJson);
            bridge.NotifyReadyIfCurrent(1);
            bridge.NotifyReadyIfCurrent(2);

            Assert.AreEqual(1, notifier.OfType(ReconstructionHostEvents.Ready).FindAll(e => e.Token == 1).Count, "token 1 never becomes ready again");
            bridge.Seek("1:40");
            Assert.AreEqual(0f, playback.CurrentTime, "stale token ignored");
            bridge.Seek("2:40");
            Assert.AreEqual(40f, playback.CurrentTime);
        }

        [Test]
        public void ResetSession_InvalidatesTheCurrentToken()
        {
            LoadAndReady(4);
            bridge.ResetSession();
            bridge.Seek("4:30");
            Assert.AreEqual(-1, bridge.CurrentToken);
            Assert.IsFalse(bridge.IsReady);
            Assert.AreEqual(0f, playback.CurrentTime);
        }

        [Test]
        public void HoldPoint_StopsPlaybackExactlyThere_AndEmitsHoldForTheCurrentToken()
        {
            LoadAndReady(9);
            bridge.SetHoldPoints("9:30");
            bridge.Play("9");
            playback.Advance(45f);

            Assert.AreEqual(30f, playback.CurrentTime);
            Assert.IsFalse(playback.IsPlaying);
            var holds = notifier.OfType(ReconstructionHostEvents.Hold);
            Assert.AreEqual(1, holds.Count);
            Assert.AreEqual(9, holds[0].Token);
            Assert.AreEqual("30", holds[0].Detail);
        }

        [Test]
        public void ReachingTheEnd_EmitsEndedOnce()
        {
            LoadAndReady(2);
            bridge.Play("2");
            playback.Advance(500f);
            playback.Advance(500f);
            Assert.AreEqual(100f, playback.CurrentTime);
            Assert.AreEqual(1, notifier.OfType(ReconstructionHostEvents.Ended).Count);
        }

        [Test]
        public void SpeedAndSeek_IgnoreInvalidValues()
        {
            LoadAndReady(6);
            bridge.SetSpeed("6:0");
            bridge.SetSpeed("6:abc");
            Assert.AreEqual(1f, playback.PlaybackSpeed);
            bridge.SetSpeed("6:2");
            Assert.AreEqual(2f, playback.PlaybackSpeed);
            bridge.Seek("6:NaN");
            Assert.AreEqual(0f, playback.CurrentTime);
        }
    }
}
