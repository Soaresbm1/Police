using UnityEngine;

namespace Caseline.Reconstruction
{
    /// <summary>
    /// U5.6 iteration 4 — one fixed, neutral material palette for every reconstruction environment (no per-environment,
    /// per-case or per-role variation, so it can never carry information). It exists to break the large same-value grey
    /// surfaces of the blockout look: the floor is a lighter cool grey, walls a darker warm grey, and architectural props
    /// (pillars, counters, partitions, baseboard trim) a lighter warm tone, so floor / wall / prop separate by value AND
    /// hue, which also makes the dark actor mannequins read against them.
    /// </summary>
    public static class ReconstructionEnvironmentPalette
    {
        public static readonly Color Floor = new(0.27f, 0.28f, 0.31f);
        public static readonly Color Wall = new(0.29f, 0.26f, 0.23f);
        public static readonly Color Prop = new(0.40f, 0.34f, 0.28f);
        public static readonly Color ZoneMarker = new(0.75f, 0.6f, 0.2f, 0.5f);

        public static float Luminance(Color c) => 0.2126f * c.r + 0.7152f * c.g + 0.0722f * c.b;
    }
}
