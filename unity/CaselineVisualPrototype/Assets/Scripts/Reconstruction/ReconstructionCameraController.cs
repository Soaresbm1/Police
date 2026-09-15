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
        [SerializeField] private Camera overviewCamera;
        [SerializeField] private Camera closeCamera;

        private static readonly HashSet<string> CloseSlots = new() { "interaction", "crime_point" };

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
