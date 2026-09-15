using UnityEngine;

namespace Caseline.Reconstruction
{
    /// <summary>
    /// Phase U5.2 — structural parity with `CCTVWebBridge` only, so a later
    /// phase can wire a real CASELINE-side caller onto the same
    /// `unityInstance.SendMessage('ReconstructionWebBridge',
    /// 'LoadScenarioJson', json)` shape without inventing a new bridge
    /// pattern. NOT wired onto any scene GameObject yet, and NOT called
    /// from any CASELINE/Next.js code — this phase explicitly does not
    /// integrate the reconstruction into the player-facing UI (U5.3 will).
    ///
    /// Same truth-safety note as `CCTVWebBridge`: this class only parses
    /// and validates JSON — it has no way to reach CaseTruth, and the
    /// schema it accepts has no field for one anyway (see
    /// `ReconstructionJsonLoader`).
    /// </summary>
    public class ReconstructionWebBridge : MonoBehaviour
    {
        [SerializeField] private ReconstructionPlaybackController playback;

        public void LoadScenarioJson(string json)
        {
            if (playback == null)
            {
                Debug.LogError("[Reconstruction] ReconstructionWebBridge has no PlaybackController wired — cannot apply scenario.");
                return;
            }

            if (!ReconstructionJsonLoader.TryLoad(json, out var scenario, out var error))
            {
                Debug.LogError($"[Reconstruction] ReconstructionWebBridge rejected an invalid scenario: {error}");
                return;
            }

            playback.Load(scenario);
        }
    }
}
