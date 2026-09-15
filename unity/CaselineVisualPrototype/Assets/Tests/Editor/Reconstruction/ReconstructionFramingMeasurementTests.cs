using Caseline.Reconstruction;
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
            // Far behind the camera's own forward direction.
            var actorPos = new Vector3(0, 0, -20f);
            var occupancy = ReconstructionFramingMeasurement.VerticalOccupancy(cam, actorPos);
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
            // This phase must fix framing via camera geometry, never by
            // scaling the actor (req. 5) — the constant itself is the
            // enforcement: if a future change ever adjusted this away from
            // the real rig height to "cheat" an occupancy target, this
            // test documents and catches that.
            Assert.AreEqual(1.78f, ReconstructionFramingMeasurement.ActorHeightMeters);
        }

        [Test]
        public void ActiveCameraSlotCombinations_ForRealPocLayout_AreNotClipped()
        {
            // The real POC scenario's environment is "generic"; its actors
            // only ever occupy interaction/crime_point/exit — reproduces
            // the same fixed camera specs ReconstructionSceneBuilder uses.
            var overview = MakeCamera(new Vector3(0f, 6.75f, -9.78f), new Vector3(0f, -0.7f, 1f), 55f);
            var close = MakeCamera(new Vector3(0f, 2.5f, -6.5f), new Vector3(0f, -0.25f, 1f), 50f);

            var interaction = ReconstructionZoneLayout.GetZonePosition("generic", "interaction");
            var crimePoint = ReconstructionZoneLayout.GetZonePosition("generic", "crime_point");
            var exit = ReconstructionZoneLayout.GetZonePosition("generic", "exit");

            Assert.IsFalse(ReconstructionFramingMeasurement.IsClipped(close, interaction));
            Assert.IsFalse(ReconstructionFramingMeasurement.IsClipped(close, crimePoint));
            Assert.IsFalse(ReconstructionFramingMeasurement.IsClipped(overview, exit));

            Object.DestroyImmediate(overview.gameObject);
            Object.DestroyImmediate(close.gameObject);
        }
    }
}
