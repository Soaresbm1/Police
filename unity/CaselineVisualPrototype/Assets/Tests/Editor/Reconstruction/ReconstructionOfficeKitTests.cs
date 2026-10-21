using System.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Caseline.Reconstruction.Tests
{
    /// <summary>
    /// The optional office kit. The data tests (dressing placement, vocabulary, skins) run on every machine because the
    /// dressing's boxes are part of the occlusion model whether or not the art is installed. The placement tests need
    /// the locally installed kit and are skipped (Assume) on a clone that does not have it.
    /// </summary>
    public class ReconstructionOfficeKitTests
    {
        private static readonly string[] BeatSlots = { "interaction", "crime_point", "interior_center" };

        // ---- data: runs everywhere ----

        [Test]
        public void Dressing_OnlyExistsForTheCorridor_AndIsDeterministic()
        {
            foreach (var env in ReconstructionSchema.EnvironmentKinds.Where(e => e != "corridor"))
            {
                Assert.AreEqual(0, ReconstructionOfficeDressing.Items(env).Count, $"{env} has no office dressing");
            }
            var a = ReconstructionOfficeDressing.Items("corridor");
            var b = ReconstructionOfficeDressing.Items("corridor");
            Assert.Greater(a.Count, 0);
            Assert.AreEqual(a.Count, b.Count);
            for (var i = 0; i < a.Count; i++)
            {
                Assert.AreEqual(a[i].Name, b[i].Name);
                Assert.AreEqual(a[i].Prefab, b[i].Prefab);
                Assert.AreEqual(a[i].Footprint, b[i].Footprint);
            }
        }

        [Test]
        public void Dressing_IsNeutralFurnishingOnly_NothingThatCouldReadAsEvidence()
        {
            var forbidden = new[] { "Wep", "Gun", "Alcohol", "Bottle", "Pills", "Inhaler", "Knife", "Axe", "Rope", "Cord", "Paper", "Note", "Photo", "Phone", "Cellphone", "Briefcase", "ID_Card", "Camera", "Syringe" };
            foreach (var item in ReconstructionOfficeDressing.Items("corridor"))
            {
                CollectionAssert.Contains(ReconstructionOfficeDressing.AllowedNames, item.Name);
                foreach (var word in forbidden) StringAssert.DoesNotContain(word, item.Prefab, $"{item.Name} uses {item.Prefab}");
            }
            foreach (var env in ReconstructionSchema.EnvironmentKinds)
            {
                for (var i = 0; i < 6; i++)
                {
                    foreach (var name in new[] { "Door", "DoorFrame", "EndDoor", "EndDoorFrame", "CeilingPanel", "Ceiling", "Baseboard" })
                    {
                        var skin = ReconstructionOfficeSkins.For(env, name, i);
                        if (!skin.HasValue || skin.Value.Hide) continue;
                        foreach (var word in forbidden) StringAssert.DoesNotContain(word, skin.Value.Prefab, $"{env}/{name}");
                    }
                }
            }
        }

        [Test]
        public void Skins_OnlyTouchTheCorridor_AndTakeOnlyTheKindAndPieceName()
        {
            foreach (var env in ReconstructionSchema.EnvironmentKinds.Where(e => e != "corridor"))
            {
                foreach (var name in new[] { "Door", "DoorFrame", "CeilingPanel", "Building", "Opening" })
                {
                    Assert.IsFalse(ReconstructionOfficeSkins.For(env, name, 0).HasValue, $"{env}/{name}");
                }
            }
            Assert.IsTrue(ReconstructionOfficeSkins.For("corridor", "Door", 0).HasValue);
            Assert.IsNull(ReconstructionOfficeSkins.For("corridor", "FloorLine", 0), "pieces the kit does not know keep their box");
        }

        [Test]
        public void Dressing_StaysAgainstTheFarWall_ClearOfTheBeat_TheBackdropAndTheDoorways()
        {
            var doors = ReconstructionEnvironmentStructure.Pieces("corridor").Where(p => p.Name == "DoorFrame" || p.Name == "EndDoorFrame").Select(p => p.Bounds).ToList();
            foreach (var item in ReconstructionOfficeDressing.Items("corridor"))
            {
                var f = item.Footprint;
                Assert.GreaterOrEqual(f.min.y, 0f, $"{item.Name} stands on or above the floor");
                Assert.LessOrEqual(f.max.z, 2.45f, $"{item.Name} stays inside the far wall");
                Assert.GreaterOrEqual(f.min.x, -7.7f, item.Name);
                Assert.LessOrEqual(f.max.x, 7.7f, item.Name);

                if (f.min.y < 2.9f)
                {
                    Assert.GreaterOrEqual(f.min.z, 1.6f, $"{item.Name}: furnishings stay on the far-wall strip");
                    Assert.IsFalse(f.max.x > -3.2f && f.min.x < 2.0f, $"{item.Name} intrudes on the plain wall directly behind the beat");
                    // Floor-standing pieces must not block a doorway; a sign mounted above a door is the point of it.
                    if (f.min.y < 1f)
                    {
                        foreach (var door in doors.Where(d => d.min.y < 0.1f))
                        {
                            Assert.IsFalse(f.min.x < door.max.x && f.max.x > door.min.x, $"{item.Name} stands in front of a doorway");
                        }
                    }
                }

                foreach (var slot in BeatSlots)
                {
                    var p = ReconstructionZoneLayout.GetZonePosition("corridor", slot);
                    var footprint = new Bounds(new Vector3(f.center.x, 0f, f.center.z), new Vector3(f.size.x, 1f, f.size.z));
                    Assert.GreaterOrEqual(Mathf.Sqrt(footprint.SqrDistance(new Vector3(p.x, 0f, p.z))), 1.6f, $"{item.Name} is too close to the {slot} slot");
                }
            }
        }

        [Test]
        public void Dressing_IsCountedByTheOcclusionModel_WhetherOrNotTheKitIsInstalled()
        {
            var occluders = ReconstructionEnvironmentController.OccluderBounds("corridor");
            foreach (var item in ReconstructionOfficeDressing.Items("corridor"))
            {
                CollectionAssert.Contains(occluders, item.Footprint, item.Name);
            }
        }

        // ---- placement: needs the locally installed kit ----

        private GameObject _go;
        private Material _shared;

        [TearDown]
        public void TearDown()
        {
            if (_go != null) Object.DestroyImmediate(_go);
            if (_shared != null) Object.DestroyImmediate(_shared);
        }

        private Transform BuildCorridor()
        {
            Assume.That(ReconstructionOfficeKit.IsAvailable, "the office kit is not installed on this machine");
            _shared = new Material(Shader.Find("Standard"));
            _go = new GameObject("KitProbe");
            _go.AddComponent<ReconstructionEnvironmentController>().Build("corridor", _shared, _shared, _shared, _shared);
            var root = _go.transform.Find(ReconstructionEnvironmentController.KitRootName);
            Assert.IsNotNull(root, "the kit draws under one child");
            return root;
        }

        [Test]
        public void Kit_DrawsDoorsAndEveryFurnishing_StandingOnTheFloorInsideTheirFootprint()
        {
            var root = BuildCorridor();
            foreach (var item in ReconstructionOfficeDressing.Items("corridor"))
            {
                // Two items can share a name (two plants): take the instance standing nearest this item's footprint.
                var instance = root.Cast<Transform>().Where(t => t.name == item.Name).OrderBy(t => Mathf.Abs(Combined(t.gameObject).center.x - item.Footprint.center.x)).FirstOrDefault();
                Assert.IsNotNull(instance, item.Name);
                var bounds = Combined(instance.gameObject);
                Assert.AreEqual(item.Footprint.min.y, bounds.min.y, 0.02f, $"{item.Name} stands on the bottom of its footprint");
                Assert.AreEqual(item.Footprint.size.y, bounds.size.y, 0.03f, $"{item.Name} is fitted to its height");
                Assert.AreEqual(item.Footprint.center.x, bounds.center.x, 0.05f, item.Name);
            }

            var doors = root.Cast<Transform>().Where(t => t.name == "Door").ToList();
            Assert.AreEqual(ReconstructionEnvironmentStructure.Pieces("corridor").Count(p => p.Name == "Door"), doors.Count, "one kit door per box door");
            foreach (var door in doors)
            {
                var bounds = Combined(door.gameObject);
                Assert.AreEqual(2.1f, bounds.size.y, 0.05f);
                Assert.AreEqual(0f, bounds.min.y, 0.02f);
                // The far wall is 0.3 m thick (inner face z = 2.45, outer face z = 2.75); a door may sink into it, never through it.
                Assert.Less(bounds.max.z, 2.7f, "a door does not poke through the far wall");
            }
        }

        [Test]
        public void Kit_ReplacesTheBoxDoorsAndPanels_ButKeepsEveryOtherBoxAndTheirBounds()
        {
            BuildCorridor();
            var drawn = _go.GetComponentsInChildren<MeshRenderer>().Where(r => !r.transform.IsChildOf(_go.transform.Find(ReconstructionEnvironmentController.KitRootName))).Select(r => r.name).ToList();
            foreach (var replaced in new[] { "Door", "DoorFrame", "EndDoor", "EndDoorFrame", "CeilingPanel" })
            {
                CollectionAssert.DoesNotContain(drawn, replaced, $"{replaced} boxes are replaced by kit pieces");
            }
            foreach (var kept in new[] { "Floor", "Wall", "Ceiling", "Baseboard", "FloorLine" })
            {
                CollectionAssert.Contains(drawn, kept, $"{kept} keeps its box");
            }
        }

        [Test]
        public void Kit_HasNoCollidersLightsOrScripts_AndStaysWithinABudget()
        {
            var root = BuildCorridor();
            Assert.AreEqual(0, root.GetComponentsInChildren<Collider>().Length, "WebGL strips Physics; the scenery never needs it");
            Assert.AreEqual(0, root.GetComponentsInChildren<Light>().Length);
            Assert.AreEqual(0, root.GetComponentsInChildren<MonoBehaviour>().Length);
            var renderers = root.GetComponentsInChildren<MeshRenderer>();
            var tris = root.GetComponentsInChildren<MeshFilter>().Sum(f => f.sharedMesh.triangles.Length / 3);
            Debug.Log($"[office kit budget] corridor: renderers={renderers.Length} tris={tris} materials={renderers.SelectMany(r => r.sharedMaterials).Distinct().Count()}");
            Assert.LessOrEqual(renderers.Length, 60);
            Assert.LessOrEqual(tris, 40000);
            Assert.IsTrue(renderers.All(r => r.shadowCastingMode == UnityEngine.Rendering.ShadowCastingMode.Off), "scenery only receives shadows");
        }

        [Test]
        public void Kit_NeverUsesTheMagentaErrorShader()
        {
            var root = BuildCorridor();
            foreach (var renderer in root.GetComponentsInChildren<MeshRenderer>())
            {
                foreach (var material in renderer.sharedMaterials)
                {
                    Assert.IsNotNull(material, renderer.name);
                    Assert.AreNotEqual("Hidden/InternalErrorShader", material.shader.name, $"{renderer.name}/{material.name}");
                    Assert.IsTrue(material.shader.isSupported, $"{renderer.name}/{material.name}");
                }
            }
        }

        private static Bounds Combined(GameObject root)
        {
            var renderers = root.GetComponentsInChildren<Renderer>();
            var bounds = renderers[0].bounds;
            foreach (var r in renderers.Skip(1)) bounds.Encapsulate(r.bounds);
            return bounds;
        }
    }
}
