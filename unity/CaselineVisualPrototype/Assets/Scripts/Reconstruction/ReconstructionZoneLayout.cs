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

        /// <summary>Fixed lateral standing offsets, in metres, so that two
        /// actors sharing one slot (which every `talk` and every `attack`
        /// does by construction — attacker and target are both staged at the
        /// event's slot) do not render at identical coordinates and merge
        /// into a single silhouette. Found by U5.2.1's visual QA: before
        /// this, the attack beat showed one body, not two.
        ///
        /// SAME PRESENTATION-ONLY STATUS AS THE SLOT TABLE ABOVE. This is
        /// not a claim that the people stood one metre apart, or on those
        /// sides of each other — CaseTruth carries no sub-location spatial
        /// data at all. It is a fixed, RNG-free staging table whose only
        /// purpose is that each actor stays separately readable on screen.
        /// Keyed on the role the scenario already states, so it infers
        /// nothing the viewer is not already told by the on-screen label.</summary>
        private static readonly Dictionary<string, float> LateralOffsetByRole = new()
        {
            ["culprit"] = -0.55f,
            ["victim"] = 0.55f,
            ["accomplice"] = -1.35f,
            ["unnamed"] = 1.35f,
        };

        /// <summary>The staging position for one actor at one slot: the
        /// slot's own coordinate plus that actor's fixed lateral offset.
        /// Deterministic — same role and slot always give the same point.</summary>
        public static Vector3 GetActorZonePosition(string environment, string slot, string roleForReconstruction)
        {
            var basePosition = GetZonePosition(environment, slot);
            var offset = roleForReconstruction != null && LateralOffsetByRole.TryGetValue(roleForReconstruction, out var x) ? x : 0f;
            return basePosition + new Vector3(offset, 0f, 0f);
        }
    }
}
