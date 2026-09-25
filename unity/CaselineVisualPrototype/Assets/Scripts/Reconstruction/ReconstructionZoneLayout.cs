using System.Collections.Generic;
using System.Linq;
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

        // Post-U5.7 staging-bounds fix. Root cause: GetActorZonePosition used to add the role offset unconditionally,
        // with no awareness of where the environment's own boundary wall is. Every environment kind's boundary walls
        // sit at |x| = 8 (ReconstructionEnvironmentStructure.FloorHalfExtent, duplicated here as a constant so this
        // file never depends on environment geometry construction order or load timing). An exhaustive audit of all 5
        // environments x 5 slots x 4 roles (100 combinations) found exactly two unsafe results, both at `street`
        // (the only environment whose entrance/exit sit at |x| = 7, one metre further out than every other
        // environment's entrance/exit): entrance+accomplice at x = -8.35, and exit+unnamed at x = +8.35 — both a
        // full 0.35 m past the wall. Every interaction/crime_point/interior_center combination, and every
        // entrance/exit combination in corridor/parking/shop/generic, already lands within the safe zone below and
        // is completely unaffected (the scale computed for them is exactly 1, so their positions are unchanged to
        // the bit).
        private const float PresentationBoundary = 8f; // matches every environment's boundary wall (|x| = FloorHalfExtent)

        // The mannequin's widest standing extent is the shoulder/upper-arm line, ~0.245 m from the root
        // (TorsoDims top half-width 0.20 m plus the shoulder-mounted upper arm's own half-width and offset — see
        // ReconstructionActorVisualPolish, U5.6, frozen). Rounded up to 0.30 m so the actor's visible silhouette,
        // not just its root transform, stays inside the wall.
        private const float ActorPresentationHalfWidth = 0.30f;
        private const float SafePresentationHalfExtent = PresentationBoundary - ActorPresentationHalfWidth;

        // The largest offset any role can request — read from the table above so this can never drift out of sync
        // with it. Two roles (accomplice/unnamed) already use this exact magnitude; if that ever changes, the safety
        // calculation below adapts automatically.
        private static readonly float WidestOffsetMagnitude = LateralOffsetByRole.Values.Select(Mathf.Abs).Max();

        /// <summary>1 when every role's offset already fits inside the safe presentation zone at this slot (the
        /// overwhelming majority of environment/slot combinations); otherwise the largest factor that brings the
        /// WIDEST possible offset back inside the wall. Applying the same factor to every role's offset (not just the
        /// one that was unsafe) keeps their relative order and proportion — nobody crosses to the opposite side of
        /// the group, and a role that was already safe only moves if its neighbours also needed to move.</summary>
        private static float SafeOffsetScale(float baseX)
        {
            var worstCase = Mathf.Abs(baseX) + WidestOffsetMagnitude;
            if (worstCase <= SafePresentationHalfExtent) return 1f;
            var available = SafePresentationHalfExtent - Mathf.Abs(baseX);
            return Mathf.Max(0f, available / WidestOffsetMagnitude);
        }

        /// <summary>The staging position for one actor at one slot: the slot's own coordinate plus that actor's
        /// lateral offset, scaled down only enough to keep the actor's visible silhouette inside the environment's
        /// boundary wall. Deterministic — same environment, slot and role always give the same point; the scale
        /// depends only on the slot's own base position, never on any case, seed or identity.</summary>
        public static Vector3 GetActorZonePosition(string environment, string slot, string roleForReconstruction)
        {
            var basePosition = GetZonePosition(environment, slot);
            var offset = roleForReconstruction != null && LateralOffsetByRole.TryGetValue(roleForReconstruction, out var x) ? x : 0f;
            var scale = SafeOffsetScale(basePosition.x);
            return basePosition + new Vector3(offset * scale, 0f, 0f);
        }
    }
}
