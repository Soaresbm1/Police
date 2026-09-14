using Caseline.CCTV;
using NUnit.Framework;
using UnityEngine;

namespace Caseline.CCTV.Tests
{
    public class CCTVEnvironmentControllerTests
    {
        private GameObject root;
        private CCTVEnvironmentController controller;

        [SetUp]
        public void SetUp()
        {
            root = new GameObject("EnvUnderTest");
            controller = root.AddComponent<CCTVEnvironmentController>();
        }

        [TearDown]
        public void TearDown()
        {
            Object.DestroyImmediate(root);
        }

        [TestCase("parking")]
        [TestCase("corridor")]
        [TestCase("street")]
        [TestCase("shop")]
        [TestCase("generic")]
        [TestCase("unknown-future-kind")]
        public void Build_NeverThrowsAndAlwaysProducesAFloorAndWalls(string kind)
        {
            Assert.DoesNotThrow(() => controller.Build(kind));
            // Floor (1) + 4 perimeter walls, at minimum, for every kind —
            // including an unrecognized one, which must fall back to the
            // same safe empty-room shell as "generic".
            Assert.That(root.transform.childCount, Is.GreaterThanOrEqualTo(5));
        }

        [Test]
        public void Rebuilding_ClearsThePreviousEnvironmentFirst()
        {
            controller.Build("shop");
            var shopChildCount = root.transform.childCount;
            controller.Build("parking");
            var parkingChildCount = root.transform.childCount;

            // Different kinds add different extra detail, but the point is
            // there's no leftover leak from the previous kind — child count
            // reflects only the currently-built kind, not the sum of both.
            Assert.That(parkingChildCount, Is.LessThan(shopChildCount + parkingChildCount));
            controller.Build("shop");
            Assert.AreEqual(shopChildCount, root.transform.childCount);
        }

        [Test]
        public void NoChildIsNamedLikeAPersonVehicleOrEvidenceObject()
        {
            // Structural safety net (req. 16): every primitive this class
            // ever creates must read as generic architecture, never
            // anything resembling a case-specific or narrative object.
            string[] forbiddenSubstrings = { "person", "actor", "weapon", "gun", "knife", "bag", "vehicle", "car", "blood", "evidence", "document", "body" };
            foreach (var kind in new[] { "parking", "corridor", "street", "shop", "generic" })
            {
                controller.Build(kind);
                for (var i = 0; i < root.transform.childCount; i++)
                {
                    var name = root.transform.GetChild(i).name.ToLowerInvariant();
                    foreach (var forbidden in forbiddenSubstrings)
                    {
                        Assert.That(name, Does.Not.Contain(forbidden), $"kind={kind}, child name='{name}'");
                    }
                }
            }
        }
    }
}
