using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Networking;

namespace Caseline.CCTV
{
    /// <summary>
    /// Top-level orchestrator: JSON → parser → scene controller → actor
    /// motion → CCTV rendering (Phase U1, req. 4). Positions the fixed CCTV
    /// camera from a loaded scenario, rebuilds the environment for its
    /// `scene` kind (Phase U2, req. 6/14), assigns each JSON actor entry to
    /// a scene actor slot by POSITION (not name — different CASELINE-
    /// exported scenarios use whatever `visualId` convention the real
    /// sequence descriptor already had, e.g. `actor-0`, so coupling to a
    /// specific name would be brittle), and re-applies every actor's state
    /// whenever <see cref="CCTVPlaybackController"/> reports a new time.
    ///
    /// Two entry points share the one core (<see cref="ApplyScenario"/>),
    /// per Phase U3's "no scene reload between clips" requirement:
    /// <see cref="LoadScenario"/> reads a StreamingAssets file (the dev/QA
    /// scene's demo/switcher path — see <see cref="autoLoadFromStreamingAssets"/>)
    /// and <see cref="CCTVWebBridge"/> feeds an already-parsed scenario
    /// straight from CASELINE's runtime JS bridge (the production embed
    /// path). Neither ever reloads the Unity scene itself — both just
    /// reconfigure the same environment/camera/actor GameObjects.
    ///
    /// StreamingAssets is read via <see cref="UnityWebRequest"/> rather than
    /// <c>System.IO.File</c> — the latter works in the Editor and a desktop
    /// standalone build but silently fails on WebGL, where StreamingAssets
    /// is served over HTTP rather than exposed as a real filesystem path.
    /// </summary>
    public class CCTVSceneController : MonoBehaviour
    {
        [SerializeField] private string jsonFileName = "cctv-demo.json";
        [SerializeField] private CCTVPlaybackController playback;
        [SerializeField] private CCTVOverlay overlay;
        [SerializeField] private Camera cctvCamera;
        [SerializeField] private CCTVEnvironmentController environment;
        [SerializeField] private List<CCTVActorController> sceneActors = new();

        /// <summary>True for the dev/QA scene (auto-loads
        /// <see cref="jsonFileName"/> on Start, matching Phase U1/U2
        /// behavior exactly); false for the production embed scene, which
        /// stays idle until <see cref="CCTVWebBridge"/> delivers a scenario
        /// from CASELINE — no demo footage should ever flash in the real
        /// embedded viewer.</summary>
        [SerializeField] private bool autoLoadFromStreamingAssets = true;

        private Coroutine loadRoutine;

        private void Start()
        {
            if (autoLoadFromStreamingAssets) LoadScenario(jsonFileName);
        }

        /// <summary>Loads (or reloads) a named scenario file from
        /// StreamingAssets — used both for the initial load and by the
        /// visual-QA scenario switcher (Phase U2, req. 22) to swap between
        /// several exported real CASELINE cases without restarting Play
        /// Mode.</summary>
        public void LoadScenario(string fileName)
        {
            if (loadRoutine != null) StopCoroutine(loadRoutine);
            jsonFileName = fileName;
            loadRoutine = StartCoroutine(LoadFileAndApply());
        }

        private IEnumerator LoadFileAndApply()
        {
            var path = System.IO.Path.Combine(Application.streamingAssetsPath, jsonFileName);
            using var request = UnityWebRequest.Get(path);
            yield return request.SendWebRequest();

            if (request.result != UnityWebRequest.Result.Success)
            {
                Debug.LogError($"[CCTV] Could not read scenario file at '{path}': {request.error}");
                yield break;
            }

            if (!CCTVJsonLoader.TryLoad(request.downloadHandler.text, out var scenario, out var error))
            {
                Debug.LogError($"[CCTV] Scenario JSON invalid, nothing will render: {error}");
                yield break;
            }

            ApplyScenario(scenario);
        }

        /// <summary>The one place a validated <see cref="CCTVScenarioData"/>
        /// actually gets applied to the live scene — stops any previous
        /// playback, rebuilds the environment, reconfigures (or hides) every
        /// scene actor slot, and restarts the clock at t=0. Safe to call
        /// repeatedly with a new scenario at any time; never reloads the
        /// Unity scene itself (Phase U3, req. 7/17).</summary>
        public void ApplyScenario(CCTVScenarioData scenario)
        {
            if (loadRoutine != null)
            {
                StopCoroutine(loadRoutine);
                loadRoutine = null;
            }
            playback.TimeChanged -= OnTimeChanged;

            ApplyCamera(scenario.camera, scenario.scene);
            if (environment != null) environment.Build(scenario.scene);

            if (scenario.actors.Length > sceneActors.Count)
            {
                Debug.LogWarning($"[CCTV] Scenario has {scenario.actors.Length} actors but only {sceneActors.Count} scene actor slot(s) exist — extra actors will not render.");
            }

            for (var i = 0; i < sceneActors.Count; i++)
            {
                var actorController = sceneActors[i];
                if (actorController == null) continue;
                if (i < scenario.actors.Length)
                {
                    actorController.gameObject.SetActive(true);
                    actorController.Configure(scenario.actors[i]);
                }
                else
                {
                    actorController.gameObject.SetActive(false);
                }
            }

            if (overlay != null)
            {
                overlay.SetCameraId(scenario.camera.id);
            }

            playback.Load(scenario);
            playback.TimeChanged += OnTimeChanged;
            playback.Play();
        }

        private void OnDestroy()
        {
            if (playback != null) playback.TimeChanged -= OnTimeChanged;
        }

        private void OnTimeChanged(float time)
        {
            foreach (var actorController in sceneActors)
            {
                if (actorController != null && actorController.Data != null)
                {
                    actorController.Apply(time);
                }
            }
        }

        /// <summary>Position/rotation come straight from the JSON (a fixed
        /// cosmetic preset, see <c>CAMERA_PRESETS</c> in
        /// <c>unity-cctv-bridge.ts</c>). Field of view is the one camera
        /// parameter Unity decides for itself (Phase U4.2, req. 6) — the
        /// bridge schema carries no FOV field, so it's derived purely from
        /// the already-received `environmentKind` via
        /// <see cref="CCTVCameraFraming.FieldOfViewForKind"/>, never from
        /// anything time-, actor-, or truth-related.</summary>
        private void ApplyCamera(CCTVCameraData cameraData, string environmentKind)
        {
            if (cctvCamera == null || cameraData == null) return;
            cctvCamera.transform.position = CCTVVectorUtil.ToVector3(cameraData.position);
            var rot = CCTVVectorUtil.ToVector3(cameraData.rotation);
            cctvCamera.transform.rotation = Quaternion.Euler(rot);
            cctvCamera.fieldOfView = CCTVCameraFraming.FieldOfViewForKind(environmentKind);
        }
    }
}
