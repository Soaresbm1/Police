using UnityEngine;

namespace Caseline.Reconstruction
{
    /// <summary>
    /// The shared WebGL runtime hosts CCTV and the crime reconstruction in one scene, under two roots. Exactly one
    /// root is active at a time; SendMessage only reaches active objects, so the host page calls ActivateCctv or
    /// ActivateReconstruction before talking to either bridge. Leaving reconstruction mode clears its actors,
    /// environment and session token so nothing carries into CCTV or into the next reconstruction.
    /// Holds CCTV only as a plain GameObject, so this assembly still never references CCTV code.
    /// </summary>
    public class CaselineEmbedModeController : MonoBehaviour
    {
        public const string CctvMode = "cctv";
        public const string ReconstructionMode = "reconstruction";

        [SerializeField] private GameObject cctvRoot;
        [SerializeField] private GameObject reconstructionRoot;
        [SerializeField] private ReconstructionWebBridge reconstructionBridge;
        [SerializeField] private ReconstructionSceneController reconstructionScene;

        // Ambient light is scene-wide; each mode keeps the value its own scene was authored with.
        [SerializeField] private Color cctvAmbient = new(0.24f, 0.24f, 0.26f);
        [SerializeField] private Color reconstructionAmbient = new(0.2f, 0.2f, 0.22f);

        public string ActiveMode { get; private set; } = CctvMode;

        public void Configure(
            GameObject cctv,
            GameObject reconstruction,
            ReconstructionWebBridge bridge,
            ReconstructionSceneController scene,
            Color cctvAmbientLight,
            Color reconstructionAmbientLight)
        {
            cctvRoot = cctv;
            reconstructionRoot = reconstruction;
            reconstructionBridge = bridge;
            reconstructionScene = scene;
            cctvAmbient = cctvAmbientLight;
            reconstructionAmbient = reconstructionAmbientLight;
        }

        private void Awake()
        {
            ApplyMode(CctvMode);
        }

        public void ActivateCctv(string unused) => ApplyMode(CctvMode);

        public void ActivateReconstruction(string unused) => ApplyMode(ReconstructionMode);

        public void ApplyMode(string mode)
        {
            var reconstruction = mode == ReconstructionMode;
            ClearReconstruction();
            if (cctvRoot != null) cctvRoot.SetActive(!reconstruction);
            if (reconstructionRoot != null) reconstructionRoot.SetActive(reconstruction);
            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Flat;
            RenderSettings.ambientLight = reconstruction ? reconstructionAmbient : cctvAmbient;
            ActiveMode = reconstruction ? ReconstructionMode : CctvMode;
        }

        private void ClearReconstruction()
        {
            if (reconstructionBridge != null) reconstructionBridge.ResetSession();
            if (reconstructionScene != null) reconstructionScene.ClearScenario();
        }
    }
}
