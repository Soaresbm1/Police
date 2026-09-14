using UnityEngine;

namespace Caseline.CCTV
{
    /// <summary>
    /// Phase U4.3 — deterministic frame-occupancy measurement via Unity's
    /// own camera projection math, replacing the screenshot-pixel-picking
    /// this phase's own audit found unreliable. Given a camera (already
    /// positioned/rotated/FOV'd exactly as <see cref="CCTVSceneController"/>
    /// would set it) and a standing actor's root position, this computes
    /// what fraction of the viewport height the actor's silhouette
    /// actually occupies — pure math, no rendering required, so it runs
    /// identically in batch-mode Editor tooling and in the real WebGL
    /// player.
    /// </summary>
    public static class CCTVFramingMeasurement
    {
        /// <summary>Matches the actor's real built height (Phase U4:
        /// HipsHeight 0.92 + Spine 0.20 + Chest 0.22 + Neck 0.10 + Head
        /// bone 0.10 + Head diameter 0.24 = 1.78m) — kept here as an
        /// explicit named constant rather than re-deriving it from
        /// <see cref="CCTVPrototypeBuilder"/>'s private layout constants,
        /// so this measurement stays usable from a pure test/tool context
        /// without depending on Editor-only code.</summary>
        public const float ActorHeightMeters = 1.78f;

        /// <summary>Vertical fraction (0..1) of the viewport the actor
        /// occupies, given the actor stands with feet at `actorRootWorld`
        /// (y = ground level) and is <see cref="ActorHeightMeters"/> tall.
        /// Returns 0 if the actor is entirely behind the camera (never
        /// negative, never NaN) — a deliberately conservative "not
        /// visible" result rather than a nonsensical one.</summary>
        public static float VerticalOccupancy(Camera camera, Vector3 actorRootWorld)
        {
            var feet = actorRootWorld;
            var head = actorRootWorld + Vector3.up * ActorHeightMeters;

            var feetVp = camera.WorldToViewportPoint(feet);
            var headVp = camera.WorldToViewportPoint(head);

            // Behind the camera (negative z) has no meaningful viewport Y —
            // treat as not visible rather than propagate a flipped/huge
            // value.
            if (feetVp.z <= 0f && headVp.z <= 0f) return 0f;

            var occupancy = Mathf.Abs(headVp.y - feetVp.y);
            return float.IsFinite(occupancy) ? occupancy : 0f;
        }

        /// <summary>True if either the feet or the head project outside
        /// the visible viewport (x or y outside 0..1, or behind the
        /// camera) — the actor is partially or fully clipped out of
        /// frame.</summary>
        public static bool IsClipped(Camera camera, Vector3 actorRootWorld)
        {
            var feet = actorRootWorld;
            var head = actorRootWorld + Vector3.up * ActorHeightMeters;
            return IsOutsideFrame(camera.WorldToViewportPoint(feet)) || IsOutsideFrame(camera.WorldToViewportPoint(head));
        }

        private static bool IsOutsideFrame(Vector3 viewportPoint)
        {
            return viewportPoint.z <= 0f || viewportPoint.x < 0f || viewportPoint.x > 1f || viewportPoint.y < 0f || viewportPoint.y > 1f;
        }
    }
}
