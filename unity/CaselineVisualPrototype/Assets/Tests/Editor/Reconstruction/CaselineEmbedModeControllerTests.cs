using System.Collections.Generic;
using NUnit.Framework;
using UnityEngine;

namespace Caseline.Reconstruction.Tests
{
    public class CaselineEmbedModeControllerTests
    {
        private sealed class SilentNotifier : IReconstructionHostNotifier
        {
            public void Emit(string eventType, int token, string detail) { }
        }

        private static readonly Color CctvAmbient = new(0.24f, 0.24f, 0.26f);
        private static readonly Color ReconstructionAmbient = new(0.2f, 0.2f, 0.22f);

        private readonly List<GameObject> created = new();
        private GameObject cctvRoot;
        private GameObject reconstructionRoot;
        private GameObject environment;
        private ReconstructionSceneController scene;
        private ReconstructionPlaybackController playback;
        private ReconstructionWebBridge bridge;
        private CaselineEmbedModeController mode;
        private Color previousAmbient;
        private UnityEngine.Rendering.AmbientMode previousAmbientMode;

        private GameObject Make(string name, Transform parent = null)
        {
            var go = new GameObject(name);
            if (parent != null) go.transform.SetParent(parent, false);
            else created.Add(go);
            return go;
        }

        [SetUp]
        public void SetUp()
        {
            previousAmbient = RenderSettings.ambientLight;
            previousAmbientMode = RenderSettings.ambientMode;

            cctvRoot = Make("CCTVRoot");
            reconstructionRoot = Make("ReconstructionRoot");
            environment = Make("Environment", reconstructionRoot.transform);
            var environmentController = environment.AddComponent<ReconstructionEnvironmentController>();

            var controllers = Make("Controllers", reconstructionRoot.transform);
            scene = controllers.AddComponent<ReconstructionSceneController>();
            scene.Configure(null, environmentController, null, null, null, null, null, null);
            playback = controllers.AddComponent<ReconstructionPlaybackController>();
            playback.Configure(scene);
            bridge = controllers.AddComponent<ReconstructionWebBridge>();
            bridge.Configure(playback);
            bridge.SetNotifier(new SilentNotifier());

            mode = Make("EmbedMode").AddComponent<CaselineEmbedModeController>();
            mode.Configure(cctvRoot, reconstructionRoot, bridge, scene, CctvAmbient, ReconstructionAmbient);
        }

        [TearDown]
        public void TearDown()
        {
            foreach (var go in created) Object.DestroyImmediate(go);
            created.Clear();
            RenderSettings.ambientMode = previousAmbientMode;
            RenderSettings.ambientLight = previousAmbient;
        }

        private const string ScenarioJson =
            "{\"version\":1,\"caseId\":\"mode-test\",\"environment\":\"generic\",\"durationSeconds\":100," +
            "\"actors\":[" +
            "{\"visualId\":\"actor_a\",\"roleForReconstruction\":\"culprit\",\"genericAppearance\":\"casual_dark\",\"spawnTime\":0,\"despawnTime\":100,\"waypoints\":[{\"time\":0,\"slot\":\"interaction\"},{\"time\":50,\"slot\":\"crime_point\"}]}," +
            "{\"visualId\":\"actor_b\",\"roleForReconstruction\":\"victim\",\"genericAppearance\":\"formal_light\",\"spawnTime\":0,\"despawnTime\":50,\"waypoints\":[{\"time\":0,\"slot\":\"interaction\"}]}]," +
            "\"events\":[" +
            "{\"time\":0,\"type\":\"talk\",\"actorVisualId\":\"actor_a\",\"counterpartyVisualId\":\"actor_b\",\"locationSlot\":\"interaction\"}," +
            "{\"time\":50,\"type\":\"attack\",\"actorVisualId\":\"actor_a\",\"counterpartyVisualId\":\"actor_b\",\"locationSlot\":\"crime_point\",\"safeVisualAction\":\"attack_strike\"}]}";

        private void LoadReadyScenario(int token)
        {
            bridge.LoadScenario($"{token}:{ScenarioJson}");
            bridge.NotifyReadyIfCurrent(token);
        }

        [Test]
        public void ActivateReconstruction_ShowsOnlyTheReconstructionRoot_WithItsOwnAmbientLight()
        {
            mode.ActivateReconstruction(string.Empty);
            Assert.IsFalse(cctvRoot.activeSelf);
            Assert.IsTrue(reconstructionRoot.activeSelf);
            Assert.AreEqual(CaselineEmbedModeController.ReconstructionMode, mode.ActiveMode);
            Assert.AreEqual(ReconstructionAmbient, RenderSettings.ambientLight);
        }

        [Test]
        public void ReturningToCctv_HidesAndClearsTheReconstruction()
        {
            mode.ActivateReconstruction(string.Empty);
            LoadReadyScenario(3);
            Assert.IsTrue(bridge.IsReady, "precondition: a reconstruction is loaded");

            mode.ActivateCctv(string.Empty);

            Assert.IsTrue(cctvRoot.activeSelf);
            Assert.IsFalse(reconstructionRoot.activeSelf);
            Assert.AreEqual(-1, bridge.CurrentToken);
            Assert.IsFalse(bridge.IsReady);
            Assert.IsNull(scene.Scenario);
            Assert.AreEqual(CctvAmbient, RenderSettings.ambientLight);
        }

        [Test]
        public void OpeningAnotherReconstruction_ClearsThePreviousOne()
        {
            mode.ActivateReconstruction(string.Empty);
            LoadReadyScenario(1);

            mode.ActivateReconstruction(string.Empty);

            Assert.AreEqual(-1, bridge.CurrentToken);
            Assert.IsNull(scene.Scenario);
            bridge.Seek("1:5");
            Assert.AreEqual(0f, playback.CurrentTime, "the previous load's commands no longer apply");
        }

        [Test]
        public void ReconstructionShots_NeverTouchTheCctvCamera_AndLeaveNoShotBehindWhenCctvReturns()
        {
            var cctvCamera = Make("CCTVCamera", cctvRoot.transform).AddComponent<Camera>();
            var cctvPosition = new Vector3(1.25f, 4.5f, -6.75f);
            var cctvRotation = Quaternion.Euler(32f, 12f, 0f);
            cctvCamera.transform.SetPositionAndRotation(cctvPosition, cctvRotation);
            cctvCamera.fieldOfView = 60f;

            var rig = Make("ReconstructionCameraRig", reconstructionRoot.transform);
            var overview = Make("OverviewCamera", rig.transform).AddComponent<Camera>();
            var action = Make("CloseCamera", rig.transform).AddComponent<Camera>();
            var cameras = rig.AddComponent<ReconstructionCameraController>();
            cameras.Configure(overview, action);
            scene.Configure(null, environment.GetComponent<ReconstructionEnvironmentController>(), cameras, null, null, null, null, null);

            mode.ActivateReconstruction(string.Empty);
            LoadReadyScenario(7);
            playback.Seek(50.5f);
            Assert.AreEqual(ReconstructionCameraMode.PhysicalAttack, cameras.CurrentShot!.Value.Mode, "precondition: the attack shot is on screen");
            Assert.IsTrue(action.gameObject.activeInHierarchy);

            mode.ActivateCctv(string.Empty);

            Assert.IsTrue(cctvCamera.gameObject.activeInHierarchy);
            Assert.AreEqual(cctvPosition, cctvCamera.transform.position);
            Assert.AreEqual(cctvRotation, cctvCamera.transform.rotation);
            Assert.AreEqual(60f, cctvCamera.fieldOfView);
            Assert.IsFalse(action.gameObject.activeInHierarchy, "no reconstruction camera renders in CCTV mode");
            Assert.IsFalse(overview.gameObject.activeInHierarchy);
            Assert.IsNull(cameras.CurrentShot, "nothing of the reconstruction's shot carries over");

            mode.ActivateReconstruction(string.Empty);
            LoadReadyScenario(8);
            Assert.AreEqual(ReconstructionCameraMode.Interaction, cameras.CurrentShot!.Value.Mode, "a fresh load starts from its own first shot");
        }

        [Test]
        public void ClearScenario_RemovesEnvironmentGeometry()
        {
            Make("Floor", environment.transform);
            Make("Wall", environment.transform);
            mode.ActivateReconstruction(string.Empty);
            Assert.AreEqual(0, environment.transform.childCount);
        }
    }
}
