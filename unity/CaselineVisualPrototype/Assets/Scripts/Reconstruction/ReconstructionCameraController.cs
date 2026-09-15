using System.Collections.Generic;
using UnityEngine;

namespace Caseline.Reconstruction
{
    /// <summary>
    /// Phase U5.2 — NOT CCTV (see <c>CCTVCameraFraming</c>/
    /// <c>CCTVSceneController</c> for that separate, still-untouched
    /// system). Two fixed cameras maximum per environment (req. 18): a wide
    /// overview and a closer interaction/crime-point view. Which one is
    /// active is a pure function of the current scenario time and the
    /// scenario's own event list — cuts only ever happen exactly at an
    /// event's own timestamp (a deterministic semantic boundary), never on
    /// a timer, never randomly. No tracking, no orbit, no player-controlled
    /// free camera, no shake, no zoom, no slow motion: the same
    /// scenario+time always selects the same camera.
    /// </summary>
    public class ReconstructionCameraController : MonoBehaviour
    {
        public static readonly Vector3 OverviewPosition = new(0f, 6.75f, -9.78f);
        public static readonly Vector3 OverviewDirection = new Vector3(0f, -0.7f, 1f).normalized;
        public const float OverviewFieldOfView = 55f;

        // U5.2.1's frontal close camera yawed 30° about the crime-area pivot (0, 0.65, 0.91) toward the attacker's side, same distance and pitch.
        public static readonly Vector3 ClosePosition = new(-3.71f, 2.5f, -5.51f);
        public static readonly Vector3 CloseDirection = new Vector3(3.71f, -1.85f, 6.42f).normalized;
        public const float CloseFieldOfView = 50f;

        [SerializeField] private Camera overviewCamera;
        [SerializeField] private Camera closeCamera;

        private static readonly HashSet<string> CloseSlots = new() { "interaction", "crime_point" };

        public static bool IsCloseSlot(string slot) => CloseSlots.Contains(slot);

        public static void ApplyOverviewSpec(Camera camera) => ApplySpec(camera, OverviewPosition, OverviewDirection, OverviewFieldOfView);

        public static void ApplyCloseSpec(Camera camera) => ApplySpec(camera, ClosePosition, CloseDirection, CloseFieldOfView);

        private static void ApplySpec(Camera camera, Vector3 position, Vector3 direction, float fieldOfView)
        {
            camera.transform.position = position;
            camera.transform.rotation = Quaternion.LookRotation(direction, Vector3.up);
            camera.fieldOfView = fieldOfView;
            camera.nearClipPlane = 0.1f;
            camera.farClipPlane = 100f;
        }

        public void Configure(Camera overview, Camera close)
        {
            overviewCamera = overview;
            closeCamera = close;
        }

        /// <summary>Deterministic: returns which camera should be enabled
        /// for `time`, given the scenario's own events (never wall-clock,
        /// never a random pick — see this file's doc comment).</summary>
        public static bool ShouldUseCloseCamera(ReconstructionScenarioData scenario, float time)
        {
            ReconstructionEventData current = null;
            foreach (var e in scenario.events)
            {
                if (e.time > time) break;
                current = e;
            }
            if (current == null) return false;
            return CloseSlots.Contains(current.locationSlot);
        }

        public void Apply(ReconstructionScenarioData scenario, float time)
        {
            if (overviewCamera == null || closeCamera == null) return;
            var useClose = ShouldUseCloseCamera(scenario, time);
            closeCamera.gameObject.SetActive(useClose);
            overviewCamera.gameObject.SetActive(!useClose);
        }
    }
}
