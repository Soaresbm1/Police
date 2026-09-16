using UnityEngine;

namespace Caseline.Reconstruction
{
    /// <summary>
    /// NOT CCTV (see <c>CCTVCameraFraming</c>/<c>CCTVSceneController</c> for that separate, untouched system). Shows
    /// the shot <see cref="ReconstructionCameraDirector"/> selects for the current scenario time: the fixed overview
    /// camera, or the action camera placed at one of <see cref="ReconstructionCameraPresets"/>' fixed framings.
    /// A shot is applied as a single cut and then held — no tracking, orbit, pan, zoom, shake or interpolation, and
    /// no player control. Same scenario and time, same shot, whatever the playback speed or seek history.
    /// </summary>
    public class ReconstructionCameraController : MonoBehaviour
    {
        [SerializeField] private Camera overviewCamera;

        // The action camera. Serialized under its U5.2 name so existing scene wiring stays valid.
        [SerializeField] private Camera closeCamera;

        private ReconstructionCameraShot? _applied;
        private ReconstructionCameraDirector.ShotPlan _plan;

        /// <summary>The shot on screen, or null before the first evaluation of a scenario.</summary>
        public ReconstructionCameraShot? CurrentShot => _applied;

        public static void ApplyOverviewSpec(Camera camera) => ApplyShot(camera, ReconstructionCameraPresets.Overview());

        public static void ApplyShot(Camera camera, ReconstructionCameraShot shot)
        {
            camera.transform.SetPositionAndRotation(shot.Position, shot.Rotation);
            camera.fieldOfView = shot.FieldOfView;
            camera.nearClipPlane = 0.1f;
            camera.farClipPlane = 100f;
        }

        public void Configure(Camera overview, Camera close)
        {
            overviewCamera = overview;
            closeCamera = close;
        }

        /// <summary>Forgets the shot on screen and the resolved cut list, so the next scenario's first evaluation
        /// places the camera from its own data even when it happens to select an identical shot.</summary>
        public void ResetShot()
        {
            _applied = null;
            _plan = null;
        }

        public void Apply(ReconstructionScenarioData scenario, float time)
        {
            if (overviewCamera == null || closeCamera == null) return;
            // Cuts are resolved once per scenario; a frame only looks up where `time` falls among at most a handful.
            if (_plan == null || _plan.Scenario != scenario) _plan = new ReconstructionCameraDirector.ShotPlan(scenario);
            var shot = _plan.ShotAt(time);
            if (_applied.HasValue && _applied.Value.Equals(shot)) return;

            var overview = shot.Mode == ReconstructionCameraMode.Overview;
            if (!overview) ApplyShot(closeCamera, shot);
            closeCamera.gameObject.SetActive(!overview);
            overviewCamera.gameObject.SetActive(overview);
            _applied = shot;
        }
    }
}
