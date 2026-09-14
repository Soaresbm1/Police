using Caseline.CCTV;
using NUnit.Framework;
using UnityEngine;

namespace Caseline.CCTV.Tests
{
    /// <summary>Phase U4.3 — verifies the projection-based occupancy
    /// measurement against hand-computable cases, so the diagnostic/QA
    /// tooling itself is trustworthy before it's used to tune anything.</summary>
    public class CCTVFramingMeasurementTests
    {
        private GameObject camGo;
        private Camera cam;

        [SetUp]
        public void SetUp()
        {
            camGo = new GameObject("TestCamera");
            cam = camGo.AddComponent<Camera>();
            cam.nearClipPlane = 0.1f;
            cam.farClipPlane = 100f;
        }

        [TearDown]
        public void TearDown()
        {
            Object.DestroyImmediate(camGo);
        }

        [Test]
        public void VerticalOccupancy_MatchesHandComputedValue_ForACameraLookingStraightAtTheActor()
        {
            // Camera at (0, ActorHeight/2, -d) looking straight down +Z at
            // the actor's vertical center — by symmetry, feet and head sit
            // at equal-and-opposite viewport-Y offsets from 0.5, so
            // occupancy = actorHeight / (2 * d * tan(fov/2)) exactly, the
            // same textbook formula this phase's own audit re-derived.
            const float fov = 60f;
            const float dist = 8f;
            cam.fieldOfView = fov;
            cam.transform.position = new Vector3(0f, CCTVFramingMeasurement.ActorHeightMeters / 2f, -dist);
            cam.transform.rotation = Quaternion.identity;

            var actorRoot = new Vector3(0f, 0f, 0f);
            var occupancy = CCTVFramingMeasurement.VerticalOccupancy(cam, actorRoot);

            var expected = CCTVFramingMeasurement.ActorHeightMeters / (2f * dist * Mathf.Tan(fov * Mathf.Deg2Rad / 2f));
            Assert.That(occupancy, Is.EqualTo(expected).Within(0.005f));
        }

        [Test]
        public void VerticalOccupancy_IsZero_WhenActorIsEntirelyBehindCamera()
        {
            cam.fieldOfView = 60f;
            cam.transform.position = new Vector3(0f, 1f, 10f);
            cam.transform.rotation = Quaternion.identity; // looking toward +Z, actor is behind at z=0

            var occupancy = CCTVFramingMeasurement.VerticalOccupancy(cam, Vector3.zero);
            Assert.AreEqual(0f, occupancy);
        }

        [Test]
        public void VerticalOccupancy_NeverNegativeOrNaN_AcrossManyPositions()
        {
            cam.fieldOfView = 60f;
            cam.transform.position = new Vector3(-4f, 4f, -5f);
            cam.transform.rotation = Quaternion.Euler(25f, 30f, 0f);

            for (var x = -9f; x <= 9f; x += 1.5f)
            {
                var occupancy = CCTVFramingMeasurement.VerticalOccupancy(cam, new Vector3(x, 0f, 3f));
                Assert.That(occupancy, Is.GreaterThanOrEqualTo(0f));
                Assert.IsTrue(float.IsFinite(occupancy));
            }
        }

        [Test]
        public void IsClipped_TrueWhenActorFarOutsideHorizontalFrame_FalseWhenCentered()
        {
            cam.fieldOfView = 60f;
            cam.transform.position = new Vector3(0f, 2f, -8f);
            cam.transform.rotation = Quaternion.identity;

            Assert.IsFalse(CCTVFramingMeasurement.IsClipped(cam, new Vector3(0f, 0f, 0f)));
            Assert.IsTrue(CCTVFramingMeasurement.IsClipped(cam, new Vector3(500f, 0f, 0f)));
        }

        [Test]
        public void VerticalOccupancy_IsDeterministic_SameInputsSameOutput()
        {
            cam.fieldOfView = 55f;
            cam.transform.position = new Vector3(-3f, 3.5f, -4f);
            cam.transform.rotation = Quaternion.Euler(20f, 15f, 0f);
            var actorRoot = new Vector3(2f, 0f, 3f);

            var a = CCTVFramingMeasurement.VerticalOccupancy(cam, actorRoot);
            var b = CCTVFramingMeasurement.VerticalOccupancy(cam, actorRoot);
            Assert.AreEqual(a, b);
        }
    }
}
