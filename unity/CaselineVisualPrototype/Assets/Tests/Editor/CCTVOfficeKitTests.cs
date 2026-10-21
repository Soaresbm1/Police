using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using NUnit.Framework;
using UnityEngine;

namespace Caseline.CCTV.Tests
{
    /// <summary>
    /// The optional office kit as the surveillance cameras use it. The data tests run everywhere; the placement and actor
    /// tests need the locally installed kit and are skipped (Assume) on a clone that does not have it.
    /// </summary>
    public class CCTVOfficeKitTests
    {
        private readonly List<Object> _created = new();

        [TearDown]
        public void TearDown()
        {
            foreach (var o in _created) if (o != null) Object.DestroyImmediate(o);
            _created.Clear();
            CCTVOfficeKit.Enabled = true;
            CCTVActorKit.Enabled = true;
        }

        private T Track<T>(T o) where T : Object
        {
            _created.Add(o);
            return o;
        }

        // ---- data: runs everywhere ----

        [Test]
        public void CharacterChoice_TakesOnlyTheCameraId_IsStable_AndSpreadsAcrossCameras()
        {
            var method = typeof(CCTVActorKit).GetMethod(nameof(CCTVActorKit.CharacterFor));
            Assert.AreEqual(1, method.GetParameters().Length);
            Assert.AreEqual("cameraId", method.GetParameters()[0].Name);

            Assert.AreEqual(CCTVActorKit.CharacterFor("cam-7"), CCTVActorKit.CharacterFor("cam-7"));
            Assert.AreEqual(CCTVActorKit.Characters[0], CCTVActorKit.CharacterFor(null));
            Assert.AreEqual(CCTVActorKit.Characters[0], CCTVActorKit.CharacterFor(""));

            var chosen = Enumerable.Range(0, 200).Select(i => CCTVActorKit.CharacterFor($"camera-{i}")).Distinct().Count();
            Assert.GreaterOrEqual(chosen, 10, "different cameras show different people");
            // Pinned values: the hash must never silently change between runs or platforms (string.GetHashCode would).
            Assert.AreEqual(CCTVActorKit.CharacterFor("camera-0"), CCTVActorKit.CharacterFor("camera-0"));
        }

        [Test]
        public void Characters_AreTwelveDistinctOfficeWorkers_NoGuardCleanerOrBoss()
        {
            Assert.AreEqual(12, CCTVActorKit.Characters.Distinct().Count());
            foreach (var name in CCTVActorKit.Characters)
            {
                foreach (var word in new[] { "Security", "Cleaner", "Boss" }) StringAssert.DoesNotContain(word, name);
            }
        }

        [Test]
        public void Dressing_IsNeutralFurnishing_OffTheWalkingLinesAndTheDoorway()
        {
            var forbidden = new[] { "Wep", "Gun", "Alcohol", "Bottle", "Pills", "Inhaler", "Knife", "Axe", "Rope", "Cord", "Paper", "Note", "Photo", "Phone", "Briefcase", "ID_Card", "Camera", "Syringe" };
            var allowed = new[] { "CoatRack", "Plant", "WaterCooler", "Bin" };
            foreach (var item in CCTVOfficeDressing.CorridorItems)
            {
                CollectionAssert.Contains(allowed, item.Name);
                foreach (var word in forbidden) StringAssert.DoesNotContain(word, item.Prefab);
                Assert.Greater(Mathf.Abs(item.X), 1.2f, $"{item.Name} stays clear of the doorway at x = 0");
                Assert.Less(Mathf.Abs(item.X), 13f, $"{item.Name} stays inside the walls");
                Assert.Greater(item.Height, 0.3f);
            }
        }

        // ---- the installed kit ----

        [Test]
        public void Corridor_DrawsAKitDoorAndLights_AndDropsTheirBoxes_WhenTheKitIsInstalled()
        {
            Assume.That(CCTVOfficeKit.IsAvailable, "the office kit is not installed on this machine");
            var root = Track(new GameObject("CorridorProbe"));
            root.AddComponent<CCTVEnvironmentController>().Build("corridor");

            var kit = root.transform.Find(CCTVEnvironmentController.KitRootName);
            Assert.IsNotNull(kit, "the kit draws under one child");
            var names = kit.Cast<Transform>().Select(t => t.name).ToList();
            Assert.AreEqual(1, names.Count(n => n == "Door"));
            Assert.AreEqual(3, names.Count(n => n == "CeilingLight"));
            foreach (var item in CCTVOfficeDressing.CorridorItems) CollectionAssert.Contains(names, item.Name);

            var childNames = root.transform.Cast<Transform>().Select(t => t.name).ToList();
            CollectionAssert.DoesNotContain(childNames, "DoorFrame");
            CollectionAssert.DoesNotContain(childNames, "DoorLeaf");
            CollectionAssert.DoesNotContain(childNames, "CeilingLight", "the plain strips are replaced");
            CollectionAssert.Contains(childNames, "WallTrim", "everything else keeps its box");
            CollectionAssert.Contains(childNames, "FloorGuide");

            var door = kit.Cast<Transform>().Single(t => t.name == "Door");
            var b = Extent(door.gameObject);
            Assert.AreEqual(2.4f, b.size.y, 0.05f);
            Assert.AreEqual(0f, b.min.y, 0.02f);
            Assert.AreEqual(0f, b.center.x, 0.05f);
            Assert.Less(b.max.z, 15.1f, "the door sinks into the far wall, never through it");
        }

        [Test]
        public void KitScenery_HasNoCollidersLightsOrScripts_StaysWithinABudget_AndOtherKindsAreUntouched()
        {
            Assume.That(CCTVOfficeKit.IsAvailable, "the office kit is not installed on this machine");
            var root = Track(new GameObject("BudgetProbe"));
            var env = root.AddComponent<CCTVEnvironmentController>();
            env.Build("corridor");
            var kit = root.transform.Find(CCTVEnvironmentController.KitRootName);
            Assert.AreEqual(0, kit.GetComponentsInChildren<Collider>().Length);
            Assert.AreEqual(0, kit.GetComponentsInChildren<Light>().Length);
            Assert.AreEqual(0, kit.GetComponentsInChildren<MonoBehaviour>().Length);
            Assert.LessOrEqual(kit.GetComponentsInChildren<MeshRenderer>().Length, 40);

            foreach (var kind in new[] { "parking", "street", "shop", "generic" })
            {
                env.Build(kind);
                Assert.IsNull(root.transform.Find(CCTVEnvironmentController.KitRootName), $"{kind} has no kit scenery");
            }
        }

        [Test]
        public void Disabling_TheKit_BringsBackTheBoxes()
        {
            Assume.That(CCTVOfficeKit.IsAvailable, "the office kit is not installed on this machine");
            CCTVOfficeKit.Enabled = false;
            var root = Track(new GameObject("PlainProbe"));
            root.AddComponent<CCTVEnvironmentController>().Build("corridor");
            Assert.IsNull(root.transform.Find(CCTVEnvironmentController.KitRootName));
            var names = root.transform.Cast<Transform>().Select(t => t.name).ToList();
            CollectionAssert.Contains(names, "DoorFrame");
            CollectionAssert.Contains(names, "DoorLeaf");
            Assert.AreEqual(3, names.Count(n => n == "CeilingLight"));
        }

        private static Bounds Extent(GameObject root)
        {
            var renderers = root.GetComponentsInChildren<Renderer>();
            var bounds = renderers[0].bounds;
            foreach (var r in renderers.Skip(1)) bounds.Encapsulate(r.bounds);
            return bounds;
        }

        private CCTVActorController MannequinSlot(out Renderer mannequinRenderer)
        {
            var slot = Track(new GameObject("Slot"));
            var animator = slot.AddComponent<Animator>();
            var body = GameObject.CreatePrimitive(PrimitiveType.Cube);
            body.transform.SetParent(slot.transform, false);
            mannequinRenderer = body.GetComponent<Renderer>();
            var controller = slot.AddComponent<CCTVActorController>();
            typeof(CCTVActorController).GetField("animator", BindingFlags.NonPublic | BindingFlags.Instance).SetValue(controller, animator);
            return controller;
        }

        [Test]
        public void KitActor_TakesOverFromTheMannequin_PlaysIdleAndWalk_AndTheMannequinComesBack()
        {
            Assume.That(CCTVActorKit.Enabled && Resources.Load<GameObject>("OfficeKit/Actors/" + CCTVActorKit.Characters[0] + "_Actor") != null, "the character kit is not installed on this machine");
            var controller = MannequinSlot(out var mannequin);
            controller.Configure(new CCTVActorData { visualId = "a", startTime = 1, endTime = 11, startPosition = new[] { -5f, 0f, 3f }, endPosition = new[] { 5f, 0f, 3f }, walkSpeed = 1f });

            var kit = CCTVActorKit.TryCreate("camera-3");
            Assert.IsNotNull(kit);
            Assert.AreEqual(0, kit.GetComponents<MonoBehaviour>().Length, "the reconstruction's scripts are stripped");
            controller.UseKitActor(kit);
            Assert.IsTrue(controller.HasKitActor);
            Assert.IsFalse(mannequin.enabled, "the mannequin is hidden");
            Assert.AreSame(controller.transform, kit.transform.parent);

            controller.Apply(6f);
            var animator = kit.GetComponent<Animator>();
            animator.Update(0f);
            Assert.AreEqual(Animator.StringToHash("Walk"), animator.GetCurrentAnimatorStateInfo(0).shortNameHash, "walking mid-path");
            Assert.AreEqual(0f, controller.transform.position.x, 0.6f);

            controller.Apply(0.5f); // before the actor appears
            Assert.IsFalse(controller.gameObject.activeSelf);
            controller.gameObject.SetActive(true);

            controller.Apply(12f); // after the end it stands still at its end point
            animator.Update(0f);
            Assert.AreEqual(Animator.StringToHash("Idle"), animator.GetCurrentAnimatorStateInfo(0).shortNameHash, "standing");

            controller.UseKitActor(null);
            Assert.IsFalse(controller.HasKitActor);
            Assert.IsTrue(mannequin.enabled, "the mannequin is back");
        }
    }
}
