using UnityEngine;

namespace Caseline.CCTV
{
    /// <summary>
    /// The production runtime entry point CASELINE's React embed calls via
    /// Unity WebGL's built-in <c>SendMessage(gameObjectName, methodName,
    /// value)</c> — the smallest robust browser↔Unity bridge mechanism
    /// (Phase U3, req. 6), needing no custom `.jslib` plugin. This
    /// GameObject's name (see <see cref="CCTVPrototypeBuilder.BuildEmbedScene"/>)
    /// is exactly what CASELINE's `UnityCCTVPlayer` component targets.
    ///
    /// Truth-safety note: this class parses and validates JSON, nothing
    /// more — it has no way to reach CaseTruth, and the schema it accepts
    /// (`CCTVScenarioData`) has no field for one anyway (see
    /// `CCTVJsonLoader`'s own doc comment). Whatever string CASELINE sends
    /// here is trusted only as far as `CCTVJsonLoader.TryLoad` validates
    /// it — a malformed or malicious string is rejected and logged, never
    /// applied.
    /// </summary>
    public class CCTVWebBridge : MonoBehaviour
    {
        [SerializeField] private CCTVSceneController sceneController;

        /// <summary>Called by JS via
        /// <c>unityInstance.SendMessage('WebBridge', 'LoadScenarioJson', json)</c>.
        /// Parses and validates the JSON exactly like the file-based path
        /// (<see cref="CCTVJsonLoader"/>) does — same version check, same
        /// required-field validation, same "reject cleanly, never throw"
        /// guarantee. On success, replaces whatever scenario is currently
        /// playing (stops it, clears the previous environment/actors,
        /// loads the new one, restarts at t=0) without any scene reload.
        /// On failure, the previous scenario (if any) keeps playing
        /// untouched — a bad message from the browser side can never leave
        /// the viewer in a blank/broken state.</summary>
        public void LoadScenarioJson(string json)
        {
            if (sceneController == null)
            {
                Debug.LogError("[CCTV] CCTVWebBridge has no CCTVSceneController wired — cannot apply scenario.");
                return;
            }

            if (!CCTVJsonLoader.TryLoad(json, out var scenario, out var error))
            {
                Debug.LogError($"[CCTV] CCTVWebBridge.LoadScenarioJson rejected an invalid scenario: {error}");
                return;
            }

            sceneController.ApplyScenario(scenario);
        }
    }
}
