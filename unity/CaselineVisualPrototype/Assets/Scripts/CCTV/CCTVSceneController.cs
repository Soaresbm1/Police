using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Networking;

namespace Caseline.CCTV
{
    /// <summary>
    /// Top-level orchestrator: JSON → parser → scene controller → actor
    /// motion → CCTV rendering (Phase U1, req. 4). Loads
    /// <see cref="jsonFileName"/> from StreamingAssets at Start, positions
    /// the fixed CCTV camera from it, matches each JSON actor entry to a
    /// pre-placed scene actor by `visualId`, and re-applies every actor's
    /// state whenever <see cref="CCTVPlaybackController"/> reports a new
    /// time. Deliberately thin — every actual decision (where an actor is,
    /// how it walks, what the HUD shows) lives in its own component;
    /// see the class list in the module's own report ("architecture for
    /// future CASELINE integration").
    ///
    /// StreamingAssets is read via <see cref="UnityWebRequest"/> rather than
    /// <c>System.IO.File</c> — the latter works in the Editor and a desktop
    /// standalone build but silently fails on WebGL, where StreamingAssets
    /// is served over HTTP rather than exposed as a real filesystem path.
    /// `UnityWebRequest` is the one loading method that works identically
    /// on every platform this prototype targets (found and fixed during
    /// this phase's own WebGL build verification).
    /// </summary>
    public class CCTVSceneController : MonoBehaviour
    {
        [SerializeField] private string jsonFileName = "cctv-demo.json";
        [SerializeField] private CCTVPlaybackController playback;
        [SerializeField] private CCTVOverlay overlay;
        [SerializeField] private Camera cctvCamera;
        [SerializeField] private List<CCTVActorController> sceneActors = new();

        private void Start()
        {
            StartCoroutine(LoadAndStart());
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

            var byId = new Dictionary<string, CCTVActorData>();
            foreach (var actorData in scenario.actors)
            {
                byId[actorData.visualId] = actorData;
            }

            foreach (var actorController in sceneActors)
            {
                if (actorController == null) continue;
                if (byId.TryGetValue(actorController.name, out var data))
                {
                    actorController.Configure(data);
                }
                else
                {
                    Debug.LogWarning($"[CCTV] No scenario data for scene actor '{actorController.name}' — hiding it.");
                    actorController.gameObject.SetActive(false);
                }
            }

            if (overlay != null && scenario.actors.Length > 0)
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
