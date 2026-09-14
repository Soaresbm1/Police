using System.Reflection;
using Caseline.CCTV;
using NUnit.Framework;
using UnityEngine;

namespace Caseline.CCTV.Tests
{
    /// <summary>Phase U4.2, req. 8 — pure unit tests for the new
    /// environment-keyed FOV lookup: no DOM/scene needed since
    /// <see cref="CCTVCameraFraming"/> is a pure static function.</summary>
    public class CCTVCameraFramingTests
    {
        [TestCase("corridor", 50f)]
        [TestCase("shop", 55f)]
        [TestCase("generic", 57f)]
        [TestCase("parking", 62f)]
        [TestCase("street", 65f)]
        public void FieldOfViewForKind_ReturnsTheExpectedFixedValue(string kind, float expected)
        {
            Assert.AreEqual(expected, CCTVCameraFraming.FieldOfViewForKind(kind));
        }

        [TestCase("unknown-future-kind")]
        [TestCase("")]
        [TestCase(null)]
        public void FieldOfViewForKind_UnrecognizedKind_FallsBackToGenericNeverThrows(string kind)
        {
            Assert.DoesNotThrow(() => CCTVCameraFraming.FieldOfViewForKind(kind));
            Assert.AreEqual(CCTVCameraFraming.FieldOfViewForKind("generic"), CCTVCameraFraming.FieldOfViewForKind(kind));
        }

        [Test]
        public void FieldOfViewForKind_IsDeterministic()
        {
            foreach (var kind in new[] { "corridor", "parking", "shop", "street", "generic", "anything-else" })
            {
                var a = CCTVCameraFraming.FieldOfViewForKind(kind);
                var b = CCTVCameraFraming.FieldOfViewForKind(kind);
                Assert.AreEqual(a, b);
            }
        }

        [TestCase("corridor")]
        [TestCase("parking")]
        [TestCase("shop")]
        [TestCase("street")]
        [TestCase("generic")]
        public void FieldOfViewForKind_AllFiveKinds_AreFiniteAndWithinASaneSurveillanceRange(string kind)
        {
            var fov = CCTVCameraFraming.FieldOfViewForKind(kind);
            Assert.IsTrue(float.IsFinite(fov));
            // A fixed surveillance lens, not a fisheye and not a telephoto —
            // matches req. 6's "reasonable CCTV FOV, not cinematic".
            Assert.That(fov, Is.InRange(30f, 90f));
        }
    }

    /// <summary>Phase U4.2, req. 8 — scene-controller-level determinism:
    /// the real `ApplyScenario` path (same harness pattern as
    /// <see cref="CCTVWebBridgeTests"/>) must place the camera and set its
    /// FOV identically for the same scenario, regardless of playback time,
    /// speed, seeking, or an actor's identified/anonymous state — and must
    /// never move the camera when time changes (req. 4: camera stays
    /// static, no tracking).</summary>
    public class CCTVCameraFramingSceneTests
    {
        private GameObject root;
        private CCTVSceneController sceneController;
        private CCTVPlaybackController playback;
        private Camera camera;
        private CCTVActorController actorA;

        private const string ParkingScenarioIdentified = @"{
            ""version"": 1, ""scene"": ""parking"",
            ""camera"": { ""id"": ""CAM-A"", ""position"": [-4.28,4,-1.28], ""rotation"": [27.12,45,0] },
            ""durationSeconds"": 10,
            ""actors"": [
                { ""visualId"": ""actor-0"", ""identified"": true, ""startTime"": 0, ""endTime"": 8,
                  ""startPosition"": [-4,0,3], ""endPosition"": [4,0,3], ""walkSpeed"": 1.4 }
            ]
        }";

        private const string ParkingScenarioAnonymous = @"{
            ""version"": 1, ""scene"": ""parking"",
            ""camera"": { ""id"": ""CAM-A"", ""position"": [-4.28,4,-1.28], ""rotation"": [27.12,45,0] },
            ""durationSeconds"": 10,
            ""actors"": [
                { ""visualId"": ""actor-0"", ""identified"": false, ""startTime"": 0, ""endTime"": 8,
                  ""startPosition"": [-4,0,3], ""endPosition"": [4,0,3], ""walkSpeed"": 1.4 }
            ]
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
            camera = cameraGo.AddComponent<Camera>();

            var actorAGo = new GameObject("actor-0");
            actorAGo.transform.SetParent(root.transform);
            actorA = actorAGo.AddComponent<CCTVActorController>();

            var sceneControllerGo = new GameObject("SceneController");
            sceneControllerGo.transform.SetParent(root.transform);
            sceneController = sceneControllerGo.AddComponent<CCTVSceneController>();
            SetPrivateField(sceneController, "playback", playback);
            SetPrivateField(sceneController, "overlay", overlay);
            SetPrivateField(sceneController, "cctvCamera", camera);
            SetPrivateField(sceneController, "environment", environment);
            SetPrivateField(sceneController, "sceneActors", new System.Collections.Generic.List<CCTVActorController> { actorA });
            SetPrivateField(sceneController, "autoLoadFromStreamingAssets", false);
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

        private CCTVScenarioData Parse(string json)
        {
            Assert.IsTrue(CCTVJsonLoader.TryLoad(json, out var scenario, out var error), error);
            return scenario;
        }

        [Test]
        public void SameScenario_AppliedTwice_ProducesIdenticalCameraTransformAndFov()
        {
            sceneController.ApplyScenario(Parse(ParkingScenarioIdentified));
            var pos1 = camera.transform.position;
            var rot1 = camera.transform.rotation;
            var fov1 = camera.fieldOfView;

            sceneController.ApplyScenario(Parse(ParkingScenarioIdentified));
            Assert.AreEqual(pos1, camera.transform.position);
            Assert.AreEqual(rot1, camera.transform.rotation);
            Assert.AreEqual(fov1, camera.fieldOfView);
        }

        [Test]
        public void PlaybackTimeAdvancing_NeverMovesTheCameraOrChangesItsFov()
        {
            sceneController.ApplyScenario(Parse(ParkingScenarioIdentified));
            var pos = camera.transform.position;
            var rot = camera.transform.rotation;
            var fov = camera.fieldOfView;

            foreach (var t in new[] { 0f, 1.5f, 4f, 7.9f, 9.999f })
            {
                actorA.Apply(t); // the only thing OnTimeChanged ever calls
                Assert.AreEqual(pos, camera.transform.position, $"camera moved at t={t}");
                Assert.AreEqual(rot, camera.transform.rotation, $"camera rotated at t={t}");
                Assert.AreEqual(fov, camera.fieldOfView, $"FOV changed at t={t}");
            }
        }

        [Test]
        public void PlaybackSpeedAndSeeking_NeverAffectCameraTransformOrFov()
        {
            sceneController.ApplyScenario(Parse(ParkingScenarioIdentified));
            var pos = camera.transform.position;
            var rot = camera.transform.rotation;
            var fov = camera.fieldOfView;

            playback.SetSpeed(2f);
            playback.Seek(6f);
            playback.SetSpeed(0.5f);
            playback.Seek(1f);

            Assert.AreEqual(pos, camera.transform.position);
            Assert.AreEqual(rot, camera.transform.rotation);
            Assert.AreEqual(fov, camera.fieldOfView);
        }

        [Test]
        public void IdentifiedVsAnonymous_WithIdenticalSceneAndPath_ProducesIdenticalCameraFraming()
        {
            sceneController.ApplyScenario(Parse(ParkingScenarioIdentified));
            var posIdentified = camera.transform.position;
            var rotIdentified = camera.transform.rotation;
            var fovIdentified = camera.fieldOfView;

            sceneController.ApplyScenario(Parse(ParkingScenarioAnonymous));
            Assert.AreEqual(posIdentified, camera.transform.position, "camera framing must not depend on identified/anonymous state");
            Assert.AreEqual(rotIdentified, camera.transform.rotation);
            Assert.AreEqual(fovIdentified, camera.fieldOfView);
        }

        [TestCase("corridor")]
        [TestCase("parking")]
        [TestCase("shop")]
        [TestCase("street")]
        [TestCase("generic")]
        public void AllFiveEnvironmentKinds_ProduceFiniteInBoundsCameraTransformAndFov(string kind)
        {
            var json = ParkingScenarioIdentified.Replace("\"parking\"", $"\"{kind}\"");
            sceneController.ApplyScenario(Parse(json));

            var pos = camera.transform.position;
            Assert.IsTrue(float.IsFinite(pos.x) && float.IsFinite(pos.y) && float.IsFinite(pos.z));
            Assert.IsTrue(float.IsFinite(camera.fieldOfView));
            Assert.That(camera.fieldOfView, Is.InRange(30f, 90f));
            // Sane bound: nowhere near infinity/NaN and inside the same
            // order of magnitude as the environment's own 30x30 floor.
            Assert.That(pos.magnitude, Is.LessThan(100f));
        }

        [Test]
        public void ActorScale_IsNeverAlteredByCameraFraming()
        {
            sceneController.ApplyScenario(Parse(ParkingScenarioIdentified));
            var before = actorA.transform.localScale;
            actorA.Apply(3f);
            Assert.AreEqual(before, actorA.transform.localScale, "camera/framing changes must never resize the actor");
        }
    }
}
