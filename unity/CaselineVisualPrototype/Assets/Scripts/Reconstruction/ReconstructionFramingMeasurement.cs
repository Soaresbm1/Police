using System.Collections.Generic;
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

        public static readonly float[] StandingSampleHeights = { 0.3f, 1.0f, 1.7f };
        public static readonly float[] LyingSampleHeights = { 0.2f };

        /// <summary>How many of the actor's sample points (feet, torso, head by default) have scenery between them and
        /// the camera. Geometric, not a raycast, so it needs no colliders and works on the same boxes the scene renders.</summary>
        public static int OccludedSampleCount(Vector3 cameraPosition, Vector3 actorRootWorld, IReadOnlyList<Bounds> occluders, IReadOnlyList<float> sampleHeights = null)
        {
            var occluded = 0;
            foreach (var height in sampleHeights ?? StandingSampleHeights)
            {
                var target = actorRootWorld + Vector3.up * height;
                foreach (var box in occluders)
                {
                    if (!SegmentIntersects(cameraPosition, target, box)) continue;
                    occluded++;
                    break;
                }
            }
            return occluded;
        }

        public static bool SegmentIntersects(Vector3 from, Vector3 to, Bounds box)
        {
            var delta = to - from;
            var length = delta.magnitude;
            if (length < 1e-5f) return box.Contains(from);
            return box.IntersectRay(new Ray(from, delta / length), out var distance) && distance <= length;
        }

        /// <summary>Where ReconstructionOverlay anchors an actor's role label, above the root.</summary>
        public const float LabelAnchorHeightMeters = 2.0f;

        /// <summary>The embed viewer's canvas aspect (ReconstructionViewer.tsx renders the canvas at 16 / 10).
        /// Measurements set it explicitly so they never depend on whatever the Editor's game view happens to be.</summary>
        public const float ViewerAspect = 1.6f;

        private const float ShoulderHalfWidth = 0.25f;
        private const float ShoulderHeight = 1.45f;
        private const float ReachForward = 0.7f;
        private const float ReachHeight = 1.4f;
        private const float LyingHalfLength = 0.95f;
        private const float LyingHalfWidth = 0.3f;
        private const float LyingHeight = 0.2f;

        public struct ActorShot
        {
            public bool lying;
            /// <summary>Frame-height fraction from feet to head; 0 for a lying body, where it means nothing.</summary>
            public float occupancy;
            public bool headInFrame;
            public bool feetInFrame;
            /// <summary>Every body extent sample in frame: head, feet, shoulders and a forward arm's reach, or both
            /// ends and sides of a lying body.</summary>
            public bool extentsInFrame;
            public bool labelInFrame;
            public bool behindCamera;
            public int occludedSamples;
            public int occlusionSampleCount;
            /// <summary>Viewport-space bounds of the body core (no arm reach), for silhouette separation.</summary>
            public Rect coreViewport;
        }

        /// <summary>Projects one actor's body extents, label anchor and scenery occlusion into a camera. Pure
        /// geometry on the actor's evaluated root and facing, so the same pose always measures identically.</summary>
        public static ActorShot MeasureActor(Camera camera, Vector3 root, Vector3 facing, bool lying, IReadOnlyList<Bounds> occluders)
        {
            var forward = new Vector3(facing.x, 0f, facing.z);
            forward = forward.sqrMagnitude > 1e-6f ? forward.normalized : Vector3.forward;
            var lateral = Vector3.Cross(Vector3.up, forward);

            var shot = new ActorShot { lying = lying };
            if (lying)
            {
                var head = root + forward * LyingHalfLength + Vector3.up * LyingHeight;
                var feet = root - forward * LyingHalfLength + Vector3.up * LyingHeight;
                var core = new[] { head, feet, root + lateral * LyingHalfWidth + Vector3.up * LyingHeight, root - lateral * LyingHalfWidth + Vector3.up * LyingHeight };
                shot.headInFrame = InFrame(camera, head);
                shot.feetInFrame = InFrame(camera, feet);
                shot.extentsInFrame = AllInFrame(camera, core);
                shot.behindCamera = AnyBehind(camera, core);
                shot.coreViewport = ViewportBounds(camera, core);
                shot.labelInFrame = InFrame(camera, root + Vector3.up * LabelAnchorHeightMeters);
                shot.occlusionSampleCount = 3;
                shot.occludedSamples = CountOccluded(camera.transform.position, new[] { head, root + Vector3.up * LyingHeight, feet }, occluders);
                return shot;
            }

            var headPoint = root + Vector3.up * ActorHeightMeters;
            var standingCore = new[]
            {
                root,
                headPoint,
                root + lateral * ShoulderHalfWidth + Vector3.up * ShoulderHeight,
                root - lateral * ShoulderHalfWidth + Vector3.up * ShoulderHeight,
            };
            var reach = root + forward * ReachForward + Vector3.up * ReachHeight;
            shot.occupancy = VerticalOccupancy(camera, root);
            shot.headInFrame = InFrame(camera, headPoint);
            shot.feetInFrame = InFrame(camera, root);
            shot.extentsInFrame = AllInFrame(camera, standingCore) && InFrame(camera, reach);
            shot.behindCamera = AnyBehind(camera, standingCore);
            shot.coreViewport = ViewportBounds(camera, standingCore);
            shot.labelInFrame = InFrame(camera, root + Vector3.up * LabelAnchorHeightMeters);
            shot.occlusionSampleCount = StandingSampleHeights.Length;
            shot.occludedSamples = OccludedSampleCount(camera.transform.position, root, occluders);
            return shot;
        }

        /// <summary>Viewport gap between two body cores along x: positive means the silhouettes are apart, zero or
        /// negative means they overlap on screen and can read as one figure.</summary>
        public static float HorizontalGap(Rect a, Rect b)
        {
            return a.xMax <= b.xMin ? b.xMin - a.xMax : a.xMin >= b.xMax ? a.xMin - b.xMax : -Mathf.Min(a.xMax - b.xMin, b.xMax - a.xMin);
        }

        /// <summary>How long a forward arm reach looks on screen, in frame heights (aspect-corrected), so a beat
        /// seen end-on along the view axis measures as short as it reads.</summary>
        public static float ReachScreenLength(Camera camera, Vector3 root, Vector3 facing)
        {
            var forward = new Vector3(facing.x, 0f, facing.z);
            forward = forward.sqrMagnitude > 1e-6f ? forward.normalized : Vector3.forward;
            var from = camera.WorldToViewportPoint(root + Vector3.up * ReachHeight);
            var to = camera.WorldToViewportPoint(root + forward * ReachForward + Vector3.up * ReachHeight);
            if (from.z <= 0f || to.z <= 0f) return 0f;
            var dx = (to.x - from.x) * camera.aspect;
            var dy = to.y - from.y;
            return Mathf.Sqrt(dx * dx + dy * dy);
        }

        /// <summary>Width of the floor, in metres, the camera shows at a target point's depth — a context proxy:
        /// the wider it is, the more of the environment frames the action.</summary>
        public static float FrameWidthAtPoint(Camera camera, Vector3 point)
        {
            var depth = Vector3.Dot(point - camera.transform.position, camera.transform.forward);
            if (depth <= 0f) return 0f;
            var height = 2f * depth * Mathf.Tan(camera.fieldOfView * 0.5f * Mathf.Deg2Rad);
            return height * camera.aspect;
        }

        private static bool InFrame(Camera camera, Vector3 world) => !IsOutsideFrame(camera.WorldToViewportPoint(world));

        private static bool AllInFrame(Camera camera, Vector3[] points)
        {
            foreach (var p in points)
            {
                if (!InFrame(camera, p)) return false;
            }
            return true;
        }

        private static bool AnyBehind(Camera camera, Vector3[] points)
        {
            foreach (var p in points)
            {
                if (camera.WorldToViewportPoint(p).z <= 0f) return true;
            }
            return false;
        }

        private static Rect ViewportBounds(Camera camera, Vector3[] points)
        {
            float minX = float.MaxValue, minY = float.MaxValue, maxX = float.MinValue, maxY = float.MinValue;
            foreach (var p in points)
            {
                var vp = camera.WorldToViewportPoint(p);
                minX = Mathf.Min(minX, vp.x);
                maxX = Mathf.Max(maxX, vp.x);
                minY = Mathf.Min(minY, vp.y);
                maxY = Mathf.Max(maxY, vp.y);
            }
            return Rect.MinMaxRect(minX, minY, maxX, maxY);
        }

        private static int CountOccluded(Vector3 cameraPosition, Vector3[] targets, IReadOnlyList<Bounds> occluders)
        {
            var occluded = 0;
            foreach (var target in targets)
            {
                foreach (var box in occluders)
                {
                    if (!SegmentIntersects(cameraPosition, target, box)) continue;
                    occluded++;
                    break;
                }
            }
            return occluded;
        }
    }
}
