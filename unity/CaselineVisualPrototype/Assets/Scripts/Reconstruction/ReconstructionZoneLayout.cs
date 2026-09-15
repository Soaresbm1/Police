using System.Collections.Generic;
using UnityEngine;

namespace Caseline.Reconstruction
{
    /// <summary>
    /// Phase U5.2 — deterministic cosmetic staging coordinates for the 5
    /// semantic slots, one fixed layout per environment kind.
    ///
    /// THESE COORDINATES ARE VISUAL STAGING, NOT FACTUAL CRIME-SCENE
    /// POSITIONS. CaseTruth has no spatial data below the location-id level
    /// (see the U5.0 audit, §11) — a slot like "crime_point" is a
    /// presentation choice for where the attack is staged to read clearly
    /// on screen, never a claim that the real crime happened at those exact
    /// coordinates. The same environment kind always produces the same
    /// layout (same inputs -> same outputs, no RNG at all here), so a given
    /// scenario always stages identically across replays — but "identical
    /// across replays" is a determinism guarantee, not an accuracy one.
    /// </summary>
    public static class ReconstructionZoneLayout
    {
        private static readonly Dictionary<string, Vector3> DefaultLayout = new()
        {
            ["entrance"] = new Vector3(-4f, 0f, -4f),
            ["interaction"] = new Vector3(-1.5f, 0f, -1f),
            ["crime_point"] = new Vector3(0.5f, 0f, 1.5f),
            ["interior_center"] = new Vector3(0f, 0f, 0f),
            ["exit"] = new Vector3(4f, 0f, -3f),
        };

        // Per-environment variants — different enough to read as distinct
        // spaces without inventing any factual detail; still a fixed table,
        // no randomness.
        private static readonly Dictionary<string, Dictionary<string, Vector3>> LayoutByEnvironment = new()
        {
            ["corridor"] = new Dictionary<string, Vector3>
            {
                ["entrance"] = new Vector3(-6f, 0f, 0f),
                ["interaction"] = new Vector3(-2f, 0f, 0f),
                ["crime_point"] = new Vector3(1f, 0f, 0f),
                ["interior_center"] = new Vector3(0f, 0f, 0f),
                ["exit"] = new Vector3(6f, 0f, 0f),
            },
            ["parking"] = new Dictionary<string, Vector3>
            {
                ["entrance"] = new Vector3(-5f, 0f, -3f),
                ["interaction"] = new Vector3(-1f, 0f, -1f),
                ["crime_point"] = new Vector3(1.5f, 0f, 2f),
                ["interior_center"] = new Vector3(0f, 0f, 0f),
                ["exit"] = new Vector3(5f, 0f, -3f),
            },
            ["shop"] = new Dictionary<string, Vector3>
            {
                ["entrance"] = new Vector3(-4f, 0f, -3.5f),
                ["interaction"] = new Vector3(-0.5f, 0f, -0.5f),
                ["crime_point"] = new Vector3(0.5f, 0f, 1.2f),
                ["interior_center"] = new Vector3(0f, 0f, 0f),
                ["exit"] = new Vector3(4f, 0f, -3.5f),
            },
            ["street"] = new Dictionary<string, Vector3>
            {
                ["entrance"] = new Vector3(-7f, 0f, 1f),
                ["interaction"] = new Vector3(-2f, 0f, 0.5f),
                ["crime_point"] = new Vector3(1.5f, 0f, -0.5f),
                ["interior_center"] = new Vector3(0f, 0f, 0f),
                ["exit"] = new Vector3(7f, 0f, 1f),
            },
            ["generic"] = DefaultLayout,
        };

        public static Vector3 GetZonePosition(string environment, string slot)
        {
            if (LayoutByEnvironment.TryGetValue(environment, out var layout) && layout.TryGetValue(slot, out var pos))
            {
                return pos;
            }
            return DefaultLayout.TryGetValue(slot, out var fallback) ? fallback : Vector3.zero;
        }
    }
}
