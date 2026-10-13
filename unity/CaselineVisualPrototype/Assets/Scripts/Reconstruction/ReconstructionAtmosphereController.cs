using UnityEngine;

namespace Caseline.Reconstruction
{
    /// <summary>
    /// Applies a <see cref="ReconstructionMood"/> to the reconstruction's own lights, the scene-wide ambient fill and the
    /// two reconstruction cameras' sky. Lives on the reconstruction's directional light, so it is inactive (and touches
    /// nothing) whenever CCTV mode is on; <see cref="CaselineEmbedModeController"/> sets the ambient for whichever mode
    /// it activates.
    /// </summary>
    public class ReconstructionAtmosphereController : MonoBehaviour
    {
        /// <summary>How high above its slot the focus light hangs, and how far it sits off to the side, in metres. Both
        /// are fixed, so the same slot always gets the same pool of light.</summary>
        public static readonly Vector3 FocusLightOffset = new(0.8f, 5.6f, -1.2f);

        [SerializeField] private Light sceneLight;
        [SerializeField] private Light focusLight;
        [SerializeField] private Camera overviewCamera;
        [SerializeField] private Camera closeCamera;

        private ReconstructionMood _current = ReconstructionAtmosphere.Standard;

        /// <summary>The mood last applied; the overlay reads its vignette.</summary>
        public ReconstructionMood Current => _current;

        public void Configure(Light light, Light focus, Camera overview, Camera close)
        {
            sceneLight = light;
            focusLight = focus;
            overviewCamera = overview;
            closeCamera = close;
            Apply(ReconstructionAtmosphere.Standard, Vector3.zero);
        }

        public void Apply(ReconstructionCameraMode mode, Vector3 focusPoint) => Apply(ReconstructionAtmosphere.For(mode), focusPoint);

        public void Apply(ReconstructionMood mood, Vector3 focusPoint)
        {
            _current = mood;
            if (sceneLight != null)
            {
                sceneLight.color = mood.LightColor;
                sceneLight.intensity = mood.LightIntensity;
                sceneLight.transform.rotation = mood.LightRotation;
                sceneLight.shadows = LightShadows.Soft;
                sceneLight.shadowStrength = mood.ShadowStrength;
            }
            if (focusLight != null)
            {
                var on = mood.FocusIntensity > 0.001f;
                focusLight.enabled = on;
                if (on)
                {
                    focusLight.color = mood.FocusColor;
                    focusLight.intensity = mood.FocusIntensity;
                    var aim = focusPoint + Vector3.up * 0.4f;
                    focusLight.transform.position = focusPoint + FocusLightOffset;
                    focusLight.transform.rotation = Quaternion.LookRotation(aim - focusLight.transform.position, Vector3.up);
                }
            }
            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Flat;
            RenderSettings.ambientLight = mood.Ambient;
            ApplySky(overviewCamera, mood);
            ApplySky(closeCamera, mood);
        }

        private static void ApplySky(Camera camera, ReconstructionMood mood)
        {
            if (camera == null) return;
            camera.clearFlags = mood.SolidSky ? CameraClearFlags.SolidColor : CameraClearFlags.Skybox;
            camera.backgroundColor = mood.Sky;
        }
    }
}
