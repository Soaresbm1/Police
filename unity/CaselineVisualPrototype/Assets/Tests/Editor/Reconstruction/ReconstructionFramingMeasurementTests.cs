using Caseline.Reconstruction;
using Caseline.ReconstructionEditor;
using NUnit.Framework;
using UnityEngine;

namespace Caseline.Reconstruction.Tests
{
    public class ReconstructionFramingMeasurementTests
    {
        private static Camera MakeCamera(Vector3 position, Vector3 lookDir, float fov)
        {
            var go = new GameObject("TestCamera");
            var cam = go.AddComponent<Camera>();
            cam.transform.position = position;
            cam.transform.rotation = Quaternion.LookRotation(lookDir.normalized, Vector3.up);
            cam.fieldOfView = fov;
            cam.nearClipPlane = 0.1f;
            cam.farClipPlane = 100f;
            return cam;
        }

        private static (Camera overview, Camera close) MakeSceneCameras()
        {
            var overview = new GameObject("TestOverview").AddComponent<Camera>();
            ReconstructionCameraController.ApplyOverviewSpec(overview);
            var close = new GameObject("TestClose").AddComponent<Camera>();
            ReconstructionCameraController.ApplyCloseSpec(close);
            return (overview, close);
        }

        [Test]
        public void VerticalOccupancy_IsDeterministic_SameCameraAndActor()
        {
            var cam = MakeCamera(new Vector3(0, 3, -6), new Vector3(0, -0.3f, 1f), 50f);
            var actorPos = new Vector3(0, 0, 0);
            var a = ReconstructionFramingMeasurement.VerticalOccupancy(cam, actorPos);
            var b = ReconstructionFramingMeasurement.VerticalOccupancy(cam, actorPos);
            Assert.AreEqual(a, b);
            Object.DestroyImmediate(cam.gameObject);
        }

        [Test]
        public void VerticalOccupancy_IsPositive_ForAFramedActor()
        {
            var cam = MakeCamera(new Vector3(0, 3, -6), new Vector3(0, -0.3f, 1f), 50f);
            var occupancy = ReconstructionFramingMeasurement.VerticalOccupancy(cam, Vector3.zero);
            Assert.Greater(occupancy, 0f);
            Assert.Less(occupancy, 1f);
            Object.DestroyImmediate(cam.gameObject);
        }

        [Test]
        public void VerticalOccupancy_IsZero_ForAnActorFullyBehindTheCamera()
        {
            var cam = MakeCamera(new Vector3(0, 3, -6), new Vector3(0, -0.3f, 1f), 50f);
            var occupancy = ReconstructionFramingMeasurement.VerticalOccupancy(cam, new Vector3(0, 0, -20f));
            Assert.AreEqual(0f, occupancy);
            Object.DestroyImmediate(cam.gameObject);
        }

        [Test]
        public void VerticalOccupancy_NeverNegativeOrNaN_AcrossASweepOfPositions()
        {
            var cam = MakeCamera(new Vector3(0, 3, -6), new Vector3(0, -0.3f, 1f), 50f);
            for (var x = -10f; x <= 10f; x += 1f)
            {
                for (var z = -10f; z <= 10f; z += 1f)
                {
                    var occupancy = ReconstructionFramingMeasurement.VerticalOccupancy(cam, new Vector3(x, 0, z));
                    Assert.GreaterOrEqual(occupancy, 0f);
                    Assert.IsFalse(float.IsNaN(occupancy));
                }
            }
            Object.DestroyImmediate(cam.gameObject);
        }

        [Test]
        public void IsClipped_TrueForAnActorFarOutsideTheFrame()
        {
            var cam = MakeCamera(new Vector3(0, 3, -6), new Vector3(0, -0.3f, 1f), 50f);
            Assert.IsTrue(ReconstructionFramingMeasurement.IsClipped(cam, new Vector3(500f, 0, 0)));
            Object.DestroyImmediate(cam.gameObject);
        }

        [Test]
        public void IsClipped_FalseForAWellFramedCenterActor()
        {
            var cam = MakeCamera(new Vector3(0, 3, -6), new Vector3(0, -0.3f, 1f), 50f);
            Assert.IsFalse(ReconstructionFramingMeasurement.IsClipped(cam, Vector3.zero));
            Object.DestroyImmediate(cam.gameObject);
        }

        [Test]
        public void ActorHeightConstant_MatchesTheReusedU4RigHeight_NeverMutatedToHitTargets()
        {
            Assert.AreEqual(1.78f, ReconstructionFramingMeasurement.ActorHeightMeters);
        }

        [Test]
        public void SegmentIntersects_DetectsABoxInBetween_AndIgnoresBoxesBeyondOrBeside()
        {
            var from = new Vector3(0, 1, 0);
            var between = new Bounds(new Vector3(0, 1, 5), Vector3.one);
            Assert.IsTrue(ReconstructionFramingMeasurement.SegmentIntersects(from, new Vector3(0, 1, 10), between));
            Assert.IsFalse(ReconstructionFramingMeasurement.SegmentIntersects(from, new Vector3(0, 1, 3), between), "box beyond the target");
            Assert.IsFalse(ReconstructionFramingMeasurement.SegmentIntersects(from, new Vector3(0, 1, 10), new Bounds(new Vector3(5, 1, 5), Vector3.one)), "box beside the segment");
        }

        [Test]
        public void OccludedSampleCount_CountsOnlyTheSampleHeightsActuallyBlocked()
        {
            var lowWall = new[] { new Bounds(new Vector3(0, 0.5f, 5), new Vector3(4, 1, 0.2f)) };
            var cameraAtActorHeight = new Vector3(0, 1.2f, 0);
            var actor = new Vector3(0, 0, 10);
            Assert.AreEqual(1, ReconstructionFramingMeasurement.OccludedSampleCount(cameraAtActorHeight, actor, lowWall), "a 1 m wall hides the feet sample only");
            Assert.AreEqual(0, ReconstructionFramingMeasurement.OccludedSampleCount(cameraAtActorHeight, actor, System.Array.Empty<Bounds>()));
        }

        [Test]
        public void EveryReachableActorPlacement_InAllFiveEnvironments_IsFramedAndUnoccluded()
        {
            var (overview, close) = MakeSceneCameras();
            try
            {
                foreach (var env in ReconstructionFramingReport.Environments)
                {
                    var occluders = ReconstructionEnvironmentController.OccluderBounds(env);
                    foreach (var (slot, roles) in ReconstructionFramingReport.ReachableRolesBySlot)
                    {
                        foreach (var role in roles)
                        {
                            var pos = ReconstructionZoneLayout.GetActorZonePosition(env, slot, role);
                            foreach (var cam in ReconstructionFramingReport.CamerasThatMustSee(slot, role, overview, close))
                            {
                                var label = $"{env}/{slot}/{role}/{(cam == close ? "close" : "overview")}";
                                Assert.IsFalse(ReconstructionFramingMeasurement.IsClipped(cam, pos), $"{label} clipped");
                                Assert.AreEqual(0, ReconstructionFramingMeasurement.OccludedSampleCount(cam.transform.position, pos, occluders), $"{label} occluded by scenery");
                            }
                        }
                    }
                }
            }
            finally
            {
                Object.DestroyImmediate(overview.gameObject);
                Object.DestroyImmediate(close.gameObject);
            }
        }

        [Test]
        public void GenericCrimePoint_IsVisibleFromBothCameras()
        {
            var (overview, close) = MakeSceneCameras();
            try
            {
                var occluders = ReconstructionEnvironmentController.OccluderBounds("generic");
                var crimePoint = ReconstructionZoneLayout.GetZonePosition("generic", "crime_point");
                foreach (var cam in new[] { overview, close })
                {
                    Assert.IsFalse(ReconstructionFramingMeasurement.IsClipped(cam, crimePoint));
                    Assert.AreEqual(0, ReconstructionFramingMeasurement.OccludedSampleCount(cam.transform.position, crimePoint, occluders));
                }
            }
            finally
            {
                Object.DestroyImmediate(overview.gameObject);
                Object.DestroyImmediate(close.gameObject);
            }
        }

        [Test]
        public void CloseCamera_LooksAcrossTheAttack_NotAlongTheActorsForwardAxis()
        {
            var horizontal = new Vector3(ReconstructionCameraController.CloseDirection.x, 0f, ReconstructionCameraController.CloseDirection.z);
            var yaw = Vector3.Angle(Vector3.forward, horizontal);
            Assert.That(yaw, Is.InRange(20f, 40f), "a modest off-axis yaw, so a forward strike is not foreshortened along the view direction");
        }
    }
}
