using UnityEngine;

namespace Caseline.Reconstruction
{
    /// <summary>
    /// Phase U5.2 — turns a `genericAppearance` string (e.g.
    /// "workwear_dark") into a subtle clothing-tone tint. Reads only the
    /// tone suffix (dark/light/neutral) — the category prefix is not used
    /// for rendering in V1, kept only because the TypeScript side derives
    /// it for possible future use. Deterministic and pure: same string
    /// always yields the same color.
    /// </summary>
    public static class ReconstructionAppearanceUtil
    {
        private static readonly Color BaseColor = new(0.16f, 0.16f, 0.18f);

        public static Color ToneTint(string genericAppearance)
        {
            if (string.IsNullOrEmpty(genericAppearance)) return BaseColor;
            if (genericAppearance.EndsWith("_dark")) return BaseColor * 0.6f + new Color(0, 0, 0, 0f);
            if (genericAppearance.EndsWith("_light")) return Color.Lerp(BaseColor, Color.white, 0.55f);
            return BaseColor; // neutral, or an unrecognized suffix — safe default
        }
    }
}
