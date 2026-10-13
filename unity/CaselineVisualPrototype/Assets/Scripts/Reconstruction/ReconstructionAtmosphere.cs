using UnityEngine;

namespace Caseline.Reconstruction
{
    /// <summary>
    /// One beat's lighting and mood: the directional light, the ambient fill, the sky behind the walls and how strongly
    /// the frame's edges are darkened. Presentation only.
    /// </summary>
    public readonly struct ReconstructionMood
    {
        public readonly Color LightColor;
        public readonly float LightIntensity;
        public readonly float LightPitchDegrees;
        public readonly float LightYawDegrees;
        public readonly float ShadowStrength;
        public readonly Color Ambient;

        /// <summary>False keeps the scene's own sky; true replaces it with the flat <see cref="Sky"/> colour.</summary>
        public readonly bool SolidSky;

        public readonly Color Sky;

        /// <summary>0 (none) to 1 (black corners). Drawn by the overlay, so it never touches the 3D scene.</summary>
        public readonly float Vignette;

        /// <summary>A soft pool of light over the beat's own slot (0 = off). It lights the floor and the two figures
        /// and falls away to the darker surroundings, so the eye lands on them instead of on the empty room. Casts no
        /// shadow of its own.</summary>
        public readonly float FocusIntensity;

        public readonly Color FocusColor;

        public ReconstructionMood(
            Color lightColor,
            float lightIntensity,
            float lightPitchDegrees,
            float lightYawDegrees,
            float shadowStrength,
            Color ambient,
            bool solidSky,
            Color sky,
            float vignette,
            float focusIntensity = 0f,
            Color focusColor = default)
        {
            FocusIntensity = focusIntensity;
            FocusColor = focusColor;
            LightColor = lightColor;
            LightIntensity = lightIntensity;
            LightPitchDegrees = lightPitchDegrees;
            LightYawDegrees = lightYawDegrees;
            ShadowStrength = shadowStrength;
            Ambient = ambient;
            SolidSky = solidSky;
            Sky = sky;
            Vignette = vignette;
        }

        public Quaternion LightRotation => Quaternion.Euler(LightPitchDegrees, LightYawDegrees, 0f);
    }

    /// <summary>
    /// The reconstruction's moods. The ONLY input is the camera mode the director already chose, so the mood is as
    /// deterministic as the shot: same scenario and time, same shot, same mood, whatever the playback speed or seek
    /// history. Nothing here reads a time of day, a case, a role, a motive or any evidence — "the aftermath" is a fixed
    /// presentation choice for the discovery beat, never a claim about when or how the body was found.
    ///
    /// Like the camera, a mood is a hard cut: no fade, no animation. The light's yaw is the same in both moods, so the
    /// lit side the U5.5 camera framings stand on is the lit side in both.
    /// </summary>
    public static class ReconstructionAtmosphere
    {
        /// <summary>The scene as it has always been lit (U5.2 light and ambient, unchanged), plus soft shadows and a
        /// barely-there vignette. Used by the overview, the conversation and the attack.</summary>
        public static readonly ReconstructionMood Standard = new(
            lightColor: new Color(0.98f, 0.96f, 0.9f),
            lightIntensity: 1.1f,
            lightPitchDegrees: 55f,
            lightYawDegrees: -30f,
            shadowStrength: 0.5f,
            ambient: new Color(0.2f, 0.2f, 0.22f),
            solidSky: false,
            sky: new Color(0.31f, 0.43f, 0.6f),
            vignette: 0.08f);

        /// <summary>The discovery: a lower, quieter light that throws long shadows across the floor, a muted flat sky
        /// instead of the default blue gradient, and a stronger vignette that draws the eye to the two figures. The
        /// light stays close to neutral: the environment palette separates floor (cool) from walls (warm) by hue, and
        /// a tinted light would erase that, and the contrast between the figures and what is behind them.</summary>
        public static readonly ReconstructionMood Aftermath = new(
            lightColor: new Color(0.96f, 0.96f, 0.97f),
            lightIntensity: 0.8f,
            lightPitchDegrees: 38f,
            lightYawDegrees: -30f,
            shadowStrength: 0.75f,
            ambient: new Color(0.16f, 0.17f, 0.21f),
            solidSky: true,
            sky: new Color(0.5f, 0.55f, 0.64f),
            vignette: 0.34f,
            focusIntensity: 2.3f,
            focusColor: new Color(1f, 0.97f, 0.92f));

        public static ReconstructionMood For(ReconstructionCameraMode mode) =>
            mode == ReconstructionCameraMode.Discovery ? Aftermath : Standard;

        /// <summary>The vignette's shape: 0 in the middle, rising smoothly to 1 at the corners. `nx` and `ny` are the
        /// position in the frame from -1 (left/bottom) to 1 (right/top); the result is multiplied by a mood's Vignette.</summary>
        public static float VignetteAlpha(float nx, float ny)
        {
            var distance = Mathf.Sqrt(nx * nx + ny * ny);
            return Mathf.SmoothStep(0f, 1f, Mathf.InverseLerp(0.55f, 1.35f, distance));
        }
    }
}
