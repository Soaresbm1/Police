using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Networking;

namespace Caseline.CCTV
{
    /// <summary>
    /// Top-level orchestrator: JSON → parser → scene controller → actor
    /// motion → CCTV rendering (Phase U1, req. 4). Loads a scenario file
    /// from StreamingAssets, positions the fixed CCTV camera from it,
    /// rebuilds the environment for the loaded `scene` kind (Phase U2, req.
    /// 6/14), assigns each JSON actor entry to a scene actor slot by
    /// POSITION (not name — different CASELINE-exported scenarios use
    /// whatever `visualId` convention the real sequence descriptor already
    /// had, e.g. `actor-0`, so coupling to a specific name would be
    /// brittle), and re-applies every actor's state whenever
    /// <see cref="CCTVPlaybackController"/> reports a new time.
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

        private Coroutine loadRoutine;

        private void Start()
        {
            LoadScenario(jsonFileName);
        }

        /// <summary>Loads (or reloads) a named scenario file from
        /// StreamingAssets — used both for the initial load and by the
        /// visual-QA scenario switcher (Phase U2, req. 22) to swap between
        /// several exported real CASELINE cases without restarting Play
        /// Mode.</summary>
        public void LoadScenario(string fileName)
        {
            if (loadRoutine != null) StopCoroutine(loadRoutine);
            playback.TimeChanged -= OnTimeChanged;
            jsonFileName = fileName;
            loadRoutine = StartCoroutine(LoadAndStart());
        }

        private IEnumerator LoadAndStart()
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

            ApplyCamera(scenario.camera);
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

        private void ApplyCamera(CCTVCameraData cameraData)
        {
            if (cctvCamera == null || cameraData == null) return;
            cctvCamera.transform.position = CCTVVectorUtil.ToVector3(cameraData.position);
            var rot = CCTVVectorUtil.ToVector3(cameraData.rotation);
            cctvCamera.transform.rotation = Quaternion.Euler(rot);
        }
    }
}
