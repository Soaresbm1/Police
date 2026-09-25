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

        // U5.7 — the derived material groups architecture draws from (see SceneryMaterial). One colour per group, shared
        // by every piece of that group in every environment; all matte, muted and neutral.
        public static readonly Color Recess = new(0.235f, 0.225f, 0.215f); // doorways, wall band, beams, cornice, stage plate: a step darker than the wall, visibly apart from both the dark torso and the lighter limbs
        public static readonly Color Ceiling = new(0.46f, 0.46f, 0.47f); // overhead slab: lit only by ambient, so lighter albedo
        public static readonly Color Marking = new(0.52f, 0.52f, 0.50f); // painted lines / floor guide lines: visible, never a bright stripe

        public static Color ColorOf(SceneryMaterial material) => material switch
        {
            SceneryMaterial.Wall => Wall,
            SceneryMaterial.Prop => Prop,
            SceneryMaterial.Recess => Recess,
            SceneryMaterial.Ceiling => Ceiling,
            SceneryMaterial.Marking => Marking,
            _ => Marking,
        };

        public static float Luminance(Color c) => 0.2126f * c.r + 0.7152f * c.g + 0.0722f * c.b;
    }
}



