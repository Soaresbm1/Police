using System.Reflection;
using System.Text.RegularExpressions;
using Caseline.CCTV;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;

namespace Caseline.CCTV.Tests
{
    public class CCTVWebBridgeTests
    {
        private GameObject root;
        private CCTVSceneController sceneController;
        private CCTVWebBridge bridge;
        private CCTVPlaybackController playback;
        private CCTVActorController actorA;
        private CCTVActorController actorB;

        private const string ScenarioOneActorJson = @"{
            ""version"": 1, ""scene"": ""parking"",
            ""camera"": { ""id"": ""CAM-A"", ""position"": [1,2,3], ""rotation"": [0,0,0] },
            ""durationSeconds"": 10,
            ""actors"": [
                { ""visualId"": ""actor-0"", ""identified"": true, ""startTime"": 0, ""endTime"": 8,
                  ""startPosition"": [-4,0,3], ""endPosition"": [4,0,3], ""walkSpeed"": 1.4 }
            ]
        }";

        private const string ScenarioTwoActorsJson = @"{
            ""version"": 1, ""scene"": ""corridor"",
            ""camera"": { ""id"": ""CAM-B"", ""position"": [0,4,0], ""rotation"": [10,0,0] },
            ""durationSeconds"": 12,
            ""actors"": [
                { ""visualId"": ""actor-0"", ""identified"": false, ""startTime"": 0, ""endTime"": 10,
                  ""startPosition"": [-3,0,0], ""endPosition"": [3,0,0], ""walkSpeed"": 1.0 },
                { ""visualId"": ""actor-1"", ""identified"": true, ""startTime"": 1, ""endTime"": 9,
                  ""startPosition"": [3,0,0], ""endPosition"": [-3,0,0], ""walkSpeed"": 1.2 }
            ]
        }";

        private const string InvalidJson = "{ not valid json ][";
        private const string UnknownVersionJson = @"{
            ""version"": 99, ""camera"": { ""id"":""CAM-X"", ""position"":[0,0,0], ""rotation"":[0,0,0] },
            ""durationSeconds"": 10, ""actors"": []
        }";

        [SetUp]
        public void SetUp()
        {
            root = new GameObject("Root");

            var playbackGo = new GameObject("Playback");
            playbackGo.transform.SetParent(root.transform);
            playback = playbackGo.AddComponent<CCTVPlaybackController>();

            var envGo = new GameObject("Environment");
            envGo.transform.SetParent(root.transform);
            var environment = envGo.AddComponent<CCTVEnvironmentController>();

            var overlayGo = new GameObject("Overlay");
            overlayGo.transform.SetParent(root.transform);
            var overlay = overlayGo.AddComponent<CCTVOverlay>();

            var cameraGo = new GameObject("Camera");
            cameraGo.transform.SetParent(root.transform);
            var camera = cameraGo.AddComponent<Camera>();

            var actorAGo = new GameObject("actor-0");
            actorAGo.transform.SetParent(root.transform);
            actorA = actorAGo.AddComponent<CCTVActorController>();

            var actorBGo = new GameObject("actor-1");
            actorBGo.transform.SetParent(root.transform);
            actorB = actorBGo.AddComponent<CCTVActorController>();

            var sceneControllerGo = new GameObject("SceneController");
            sceneControllerGo.transform.SetParent(root.transform);
            sceneController = sceneControllerGo.AddComponent<CCTVSceneController>();
            SetPrivateField(sceneController, "playback", playback);
            SetPrivateField(sceneController, "overlay", overlay);
            SetPrivateField(sceneController, "cctvCamera", camera);
            SetPrivateField(sceneController, "environment", environment);
            SetPrivateField(sceneController, "sceneActors", new System.Collections.Generic.List<CCTVActorController> { actorA, actorB });
            SetPrivateField(sceneController, "autoLoadFromStreamingAssets", false);

            var bridgeGo = new GameObject("WebBridge");
            bridgeGo.transform.SetParent(root.transform);
            bridge = bridgeGo.AddComponent<CCTVWebBridge>();
            SetPrivateField(bridge, "sceneController", sceneController);
        }

        [TearDown]
        public void TearDown()
        {
            Object.DestroyImmediate(root);
        }

        private static void SetPrivateField(object target, string fieldName, object value)
        {
            var field = target.GetType().GetField(fieldName, BindingFlags.NonPublic | BindingFlags.Instance);
            Assert.IsNotNull(field, $"field '{fieldName}' not found on {target.GetType()}");
            field.SetValue(target, value);
        }

        [Test]
        public void LoadScenarioJson_ValidInput_AppliesScenario()
        {
            bridge.LoadScenarioJson(ScenarioOneActorJson);

            Assert.IsNotNull(playback.Scenario);
            Assert.AreEqual(10f, playback.Scenario.durationSeconds);
            Assert.IsNotNull(actorA.Data);
            Assert.AreEqual("actor-0", actorA.Data.visualId);
        }

        [Test]
        public void LoadScenarioJson_InvalidInput_DoesNotThrowAndLeavesPreviousStateIntact()
        {
            bridge.LoadScenarioJson(ScenarioOneActorJson);
            var camIdBefore = playback.Scenario.camera.id;

            LogAssert.Expect(LogType.Error, new Regex(".*"));
            Assert.DoesNotThrow(() => bridge.LoadScenarioJson(InvalidJson));

            Assert.AreEqual(camIdBefore, playback.Scenario.camera.id);
        }

        [Test]
        public void LoadScenarioJson_UnknownVersion_RejectedCleanly()
        {
            bridge.LoadScenarioJson(ScenarioOneActorJson);
            var camIdBefore = playback.Scenario.camera.id;

            LogAssert.Expect(LogType.Error, new Regex(".*"));
            Assert.DoesNotThrow(() => bridge.LoadScenarioJson(UnknownVersionJson));

            Assert.AreEqual(camIdBefore, playback.Scenario.camera.id);
        }

        [Test]
        public void LoadScenarioJson_SecondScenario_ClearsActorSlotsNotPresentInIt()
        {
            bridge.LoadScenarioJson(ScenarioTwoActorsJson);
            Assert.IsTrue(actorA.gameObject.activeSelf);
            Assert.IsTrue(actorB.gameObject.activeSelf);

            bridge.LoadScenarioJson(ScenarioOneActorJson);
            Assert.IsTrue(actorA.gameObject.activeSelf);
            Assert.IsFalse(actorB.gameObject.activeSelf, "actor slot not present in the second scenario must be hidden, not left showing stale data");
        }

        [Test]
        public void LoadScenarioJson_SecondScenario_ReplacesEnvironmentAndCamera()
        {
            bridge.LoadScenarioJson(ScenarioOneActorJson);
            Assert.AreEqual("CAM-A", playback.Scenario.camera.id);

            bridge.LoadScenarioJson(ScenarioTwoActorsJson);
            Assert.AreEqual("CAM-B", playback.Scenario.camera.id);
            Assert.AreEqual("corridor", playback.Scenario.scene);
        }

        [Test]
        public void LoadScenarioJson_AlwaysRestartsPlaybackAtTimeZero()
        {
            bridge.LoadScenarioJson(ScenarioOneActorJson);
            playback.Seek(5f);
            Assert.AreEqual(5f, playback.CurrentTime);

            bridge.LoadScenarioJson(ScenarioTwoActorsJson);
            Assert.AreEqual(0f, playback.CurrentTime);
        }

        [Test]
        public void LoadScenarioJson_SameScenarioTwice_ReproducesTheSameState()
        {
            bridge.LoadScenarioJson(ScenarioTwoActorsJson);
            var firstDurationSeconds = playback.Scenario.durationSeconds;
            var firstActorAStart = actorA.Data.startTime;

            bridge.LoadScenarioJson(ScenarioTwoActorsJson);
            Assert.AreEqual(firstDurationSeconds, playback.Scenario.durationSeconds);
            Assert.AreEqual(firstActorAStart, actorA.Data.startTime);
            Assert.AreEqual(0f, playback.CurrentTime);
        }

        [Test]
        public void LoadScenarioJson_AnonymousActorStaysAnonymous()
        {
            bridge.LoadScenarioJson(ScenarioTwoActorsJson);
            Assert.IsFalse(actorA.Data.identified, "actor-0 in ScenarioTwoActorsJson is identified=false and must never become true");
            Assert.IsTrue(actorB.Data.identified);
        }

        [Test]
        public void LoadScenarioJson_MissingSceneController_LogsErrorAndDoesNotThrow()
        {
            var orphanGo = new GameObject("OrphanBridge");
            var orphanBridge = orphanGo.AddComponent<CCTVWebBridge>();
            LogAssert.Expect(LogType.Error, new Regex(".*"));
            Assert.DoesNotThrow(() => orphanBridge.LoadScenarioJson(ScenarioOneActorJson));
            Object.DestroyImmediate(orphanGo);
        }
    }
}
