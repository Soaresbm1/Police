using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Networking;

namespace Caseline.Reconstruction
{
    /// <summary>
    /// Phase U5.2 — orchestrates one loaded <see cref="ReconstructionScenarioData"/>:
    /// spawns/reconfigures actor GameObjects, rebuilds the environment, and
    /// drives the camera controller, all from a single absolute scenario
    /// time via <see cref="Evaluate"/>. A SEPARATE system from
    /// `CCTVSceneController` (never referenced, never modified).
    /// </summary>
    public class ReconstructionSceneController : MonoBehaviour
    {
        [SerializeField] private Transform actorsRoot;
        [SerializeField] private ReconstructionEnvironmentController environmentController;
        [SerializeField] private ReconstructionCameraController cameraController;
        [SerializeField] private GameObject actorTemplate;
        [SerializeField] private Material floorMaterial;
        [SerializeField] private Material wallMaterial;
        [SerializeField] private Material propMaterial;
        [SerializeField] private Material zoneMarkerMaterial;

        private ReconstructionScenarioData _scenario;
        private readonly List<ReconstructionActorController> _spawnedActors = new();

        public ReconstructionScenarioData Scenario => _scenario;

        /// <summary>Exposed for `ReconstructionOverlay`'s on-screen role
        /// labels (req. 9) — never for anything that decides pose/camera,
        /// which always go through <see cref="Evaluate"/> instead.</summary>
        public IReadOnlyList<ReconstructionActorController> SpawnedActors => _spawnedActors;

        public void SetCamerasForLabels(Camera overview, Camera close)
        {
            _overviewCameraForLabels = overview;
            _closeCameraForLabels = close;
        }

        // Serialized so the Editor-time wiring survives into the player:
        // without this the references are null at runtime, CurrentActiveCamera()
        // falls back to a Camera.main that no camera here is tagged as, and the
        // role labels silently never draw (found by U5.2.1's visual QA).
        [SerializeField] private Camera _overviewCameraForLabels;
        [SerializeField] private Camera _closeCameraForLabels;

        /// <summary>Whichever of the two fixed cameras is currently active
        /// — same deterministic selection `ReconstructionCameraController`
        /// already applied this frame.</summary>
        public Camera CurrentActiveCamera()
        {
            if (_closeCameraForLabels != null && _closeCameraForLabels.gameObject.activeInHierarchy) return _closeCameraForLabels;
            if (_overviewCameraForLabels != null && _overviewCameraForLabels.gameObject.activeInHierarchy) return _overviewCameraForLabels;
            return Camera.main;
        }

        public void Configure(
            Transform actorsRootTransform,
            ReconstructionEnvironmentController environment,
            ReconstructionCameraController camera,
            GameObject template,
            Material floor,
            Material wall,
            Material prop,
            Material zoneMarker)
        {
            actorsRoot = actorsRootTransform;
            environmentController = environment;
            cameraController = camera;
            actorTemplate = template;
            floorMaterial = floor;
            wallMaterial = wall;
            propMaterial = prop;
            zoneMarkerMaterial = zoneMarker;
        }

        /// <summary>Replaces whatever scenario is currently loaded (clears
        /// the previous actors, rebuilds the environment, spawns the new
        /// actor set) — mirrors `CCTVSceneController.ApplyScenario`'s
        /// "reject cleanly, never leave a half-applied state" discipline:
        /// the caller must have already validated `data` via
        /// <see cref="ReconstructionJsonLoader"/>.</summary>
        public void ApplyScenario(ReconstructionScenarioData data)
        {
            _scenario = data;

            foreach (var actor in _spawnedActors)
            {
                if (actor != null) Destroy(actor.gameObject);
            }
            _spawnedActors.Clear();

            if (environmentController != null)
            {
                environmentController.Build(data.environment, floorMaterial, wallMaterial, propMaterial, zoneMarkerMaterial);
            }

            if (actorTemplate != null && actorsRoot != null)
            {
                foreach (var actorData in data.actors)
                {
                    var instance = Object.Instantiate(actorTemplate, actorsRoot);
                    instance.name = $"Actor_{actorData.roleForReconstruction}";
                    var controller = instance.GetComponent<ReconstructionActorController>();
                    if (controller == null) controller = instance.AddComponent<ReconstructionActorController>();
                    controller.Configure(actorData, data.events, data.environment);
                    _spawnedActors.Add(controller);
                }
            }

            Evaluate(0f);
        }

        /// <summary>Removes the loaded scenario's actors and environment geometry and forgets the scenario.</summary>
        public void ClearScenario()
        {
            if (_loadRoutine != null)
            {
                StopCoroutine(_loadRoutine);
                _loadRoutine = null;
            }

            foreach (var actor in _spawnedActors)
            {
                if (actor != null) DestroyObject(actor.gameObject);
            }
            _spawnedActors.Clear();

            if (environmentController != null)
            {
                var children = new List<GameObject>();
                foreach (Transform child in environmentController.transform) children.Add(child.gameObject);
                foreach (var child in children) DestroyObject(child);
            }

            _scenario = null;
        }

        private static void DestroyObject(GameObject target)
        {
            if (Application.isPlaying) Destroy(target);
            else DestroyImmediate(target);
        }

        /// <summary>The single entry point every deterministic system in
        /// this scene is evaluated from — see
        /// `ReconstructionPlaybackController`, the only caller.</summary>
        public void Evaluate(float time)
        {
            if (_scenario == null) return;
            foreach (var actor in _spawnedActors)
            {
                actor.Apply(time);
            }
            if (cameraController != null) cameraController.Apply(_scenario, time);
        }

        [SerializeField] private ReconstructionPlaybackController playbackForFileLoads;
        private Coroutine _loadRoutine;

        public void SetPlaybackForFileLoads(ReconstructionPlaybackController controller) => playbackForFileLoads = controller;

        /// <summary>Loads a named scenario file from StreamingAssets — the
        /// dev/QA scenario switcher's only entry point (req. 24), never
        /// used by a production embed. Reads via `UnityWebRequest` rather
        /// than `System.IO.File`, same reason `CCTVSceneController` does —
        /// StreamingAssets is served over HTTP on WebGL, not exposed as a
        /// real filesystem path.</summary>
        public void LoadScenario(string fileName)
        {
            if (_loadRoutine != null) StopCoroutine(_loadRoutine);
            _loadRoutine = StartCoroutine(LoadFileAndApply(fileName));
        }

        private IEnumerator LoadFileAndApply(string fileName)
        {
            var path = System.IO.Path.Combine(Application.streamingAssetsPath, fileName);
            using var request = UnityWebRequest.Get(path);
            yield return request.SendWebRequest();

            if (request.result != UnityWebRequest.Result.Success)
            {
                Debug.LogError($"[Reconstruction] Could not read scenario file at '{path}': {request.error}");
                yield break;
            }

            if (!ReconstructionJsonLoader.TryLoad(request.downloadHandler.text, out var scenario, out var error))
            {
                Debug.LogError($"[Reconstruction] Scenario JSON invalid, nothing will render: {error}");
                yield break;
            }

            if (playbackForFileLoads != null) playbackForFileLoads.Load(scenario);
            else ApplyScenario(scenario);
        }
    }
}
