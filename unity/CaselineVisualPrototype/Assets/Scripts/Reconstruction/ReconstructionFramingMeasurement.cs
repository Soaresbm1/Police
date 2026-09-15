using UnityEngine;

namespace Caseline.Reconstruction
{
    /// <summary>
    /// Phase U5.2.1 — deterministic camera-projection occupancy measurement
    /// for the Reconstruction subsystem's own 2 fixed cameras. Same
    /// technique as U4.3's `Caseline.CCTV.CCTVFramingMeasurement`
    /// (Camera.WorldToViewportPoint, not screenshots) but a fully separate
    /// file/class — never references or modifies CCTVFramingMeasurement,
    /// per this phase's "keep CCTV and Reconstruction separate" rule
    /// carried over from U5.2.
    /// </summary>
    public static class ReconstructionFramingMeasurement
    {
        /// <summary>Matches the U4 humanoid rig's actual height (same
        /// constant `CCTVFramingMeasurement.ActorHeightMeters` uses) —
        /// Reconstruction reuses that exact rig (see
        /// `ReconstructionSceneBuilder.BuildActorTemplate`), so the two
        /// numbers must agree; duplicated rather than shared to keep the
        /// two subsystems' assemblies independent.</summary>
        public const float ActorHeightMeters = 1.78f;

        public static float VerticalOccupancy(Camera camera, Vector3 actorRootWorld)
        {
            var feet = actorRootWorld;
            var head = actorRootWorld + Vector3.up * ActorHeightMeters;
            var feetVp = camera.WorldToViewportPoint(feet);
            var headVp = camera.WorldToViewportPoint(head);
            if (feetVp.z <= 0f && headVp.z <= 0f) return 0f;
            var occupancy = Mathf.Abs(headVp.y - feetVp.y);
            return float.IsFinite(occupancy) ? occupancy : 0f;
        }

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
