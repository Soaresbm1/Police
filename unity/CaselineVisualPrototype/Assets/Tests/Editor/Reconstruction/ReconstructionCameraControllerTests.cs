using System.Collections.Generic;
using Caseline.Reconstruction;
using NUnit.Framework;
using UnityEngine;

namespace Caseline.Reconstruction.Tests
{
    public class ReconstructionCameraControllerTests
    {
        private readonly List<GameObject> created = new();

        [TearDown]
        public void TearDown()
        {
            foreach (var go in created) Object.DestroyImmediate(go);
            created.Clear();
        }

        private static ReconstructionScenarioData MakeScenario(string environment = "generic", string action = "attack_strike")
        {
            return new ReconstructionScenarioData
            {
                version = 1,
                caseId = "case-1",
                environment = environment,
                durationSeconds = 200,
                actors = new List<ReconstructionActorData>(),
                events = new List<ReconstructionEventData>
                {
                    new() { time = 0, type = "talk", actorVisualId = "a", counterpartyVisualId = "b", locationSlot = "interaction" },
                    new() { time = 20, type = "attack", actorVisualId = "a", counterpartyVisualId = "b", locationSlot = "crime_point", safeVisualAction = action },
                    new() { time = 40, type = "leave_scene", actorVisualId = "a", locationSlot = "exit" },
                    new() { time = 70, type = "stage_scene", actorVisualId = "a", locationSlot = "interior_center", safeVisualAction = "manipulate_scene" },
                    new() { time = 150, type = "discover", actorVisualId = "c", locationSlot = "crime_point" },
                },
            };
        }

        private (ReconstructionCameraController controller, Camera overview, Camera action) MakeController()
        {
            var overview = new GameObject("TestOverview").AddComponent<Camera>();
            var action = new GameObject("TestAction").AddComponent<Camera>();
            var controller = new GameObject("TestCameraRig").AddComponent<ReconstructionCameraController>();
            created.Add(overview.gameObject);
            created.Add(action.gameObject);
            created.Add(controller.gameObject);
            controller.Configure(overview, action);
            return (controller, overview, action);
        }

        private static Camera ActiveCamera(Camera overview, Camera action) => action.gameObject.activeSelf ? action : overview;

        private static void AssertShown(ReconstructionCameraShot expected, Camera overview, Camera action, string because)
        {
            var camera = ActiveCamera(overview, action);
            Assert.AreEqual(expected.Mode == ReconstructionCameraMode.Overview, camera == overview, $"{because}: active camera");
            if (camera == overview) return; // the overview camera is placed once by the scene builder, never moved
            // A Transform stores what it is given up to float normalisation, hence the (tiny) tolerance here; the shot
            // itself is compared exactly wherever selection determinism is the point.
            Assert.Less(Vector3.Distance(expected.Position, camera.transform.position), 1e-4f, $"{because}: position");
            Assert.Less(Quaternion.Angle(expected.Rotation, camera.transform.rotation), 1e-2f, $"{because}: rotation");
            Assert.AreEqual(expected.FieldOfView, camera.fieldOfView, 1e-4f, $"{because}: field of view");
        }

        private static (Vector3 position, Quaternion rotation, float fov, bool action) Snapshot(Camera overview, Camera action)
        {
            var camera = ActiveCamera(overview, action);
            return (camera.transform.position, camera.transform.rotation, camera.fieldOfView, camera == action);
        }

        [Test]
        public void SameScenarioAndTime_AlwaysSelectsTheSameModeTransformAndFieldOfView()
        {
            foreach (var t in new[] { 0f, 5f, 19.5f, 20f, 21f, 45f, 69.5f, 71f, 151f })
            {
                var a = ReconstructionCameraDirector.SelectShot(MakeScenario(), t);
                var b = ReconstructionCameraDirector.SelectShot(MakeScenario(), t);
                Assert.AreEqual(a, b, $"t={t}");
            }
        }

        [TestCase("attack_strike")]
        [TestCase("attack_stab")]
        [TestCase("attack_strangle")]
        [TestCase("attack_firearm")]
        [TestCase("attack_push")]
        public void PhysicalAttackActions_SelectThePhysicalAttackShot(string action)
        {
            Assert.AreEqual(ReconstructionCameraMode.PhysicalAttack, ReconstructionCameraDirector.SelectShot(MakeScenario(action: action), 21f).Mode);
        }

        [TestCase("attack_administer_substance")]
        [TestCase("attack_unknown_future_action")]
        [TestCase(null)]
        public void SubstanceAndUnknownActions_SelectTheNeutralInteractionShot_NeverAttackFraming(string action)
        {
            Assert.AreEqual(ReconstructionCameraMode.Interaction, ReconstructionCameraDirector.SelectShot(MakeScenario(action: action), 21f).Mode);
        }

        [Test]
        public void EventTypes_SelectTheirShots()
        {
            var scenario = MakeScenario();
            Assert.AreEqual(ReconstructionCameraMode.Interaction, ReconstructionCameraDirector.SelectShot(scenario, 5f).Mode, "talk");
            Assert.AreEqual(ReconstructionCameraMode.Overview, ReconstructionCameraDirector.SelectShot(scenario, 45f).Mode, "leave_scene");
            Assert.AreEqual(ReconstructionCameraMode.Interaction, ReconstructionCameraDirector.SelectShot(scenario, 71f).Mode, "stage_scene");
            Assert.AreEqual(ReconstructionCameraMode.Discovery, ReconstructionCameraDirector.SelectShot(scenario, 151f).Mode, "discover");
        }

        [Test]
        public void BeforeTheFirstEvent_ShowsTheOverview()
        {
            var scenario = MakeScenario();
            foreach (var e in scenario.events) e.time += 10f;
            Assert.AreEqual(ReconstructionCameraMode.Overview, ReconstructionCameraDirector.SelectShot(scenario, 2f).Mode);
        }

        [Test]
        public void StagingAndDiscovery_AimAtTheirOwnSlots()
        {
            var scenario = MakeScenario();
            Assert.AreEqual(ReconstructionCameraPresets.Shot("generic", ReconstructionCameraMode.Interaction, "interior_center"), ReconstructionCameraDirector.SelectShot(scenario, 71f));
            Assert.AreEqual(ReconstructionCameraPresets.Shot("generic", ReconstructionCameraMode.Discovery, "crime_point"), ReconstructionCameraDirector.SelectShot(scenario, 151f));
            Assert.AreEqual(ReconstructionCameraPresets.Shot("generic", ReconstructionCameraMode.Interaction, "interaction"), ReconstructionCameraDirector.SelectShot(scenario, 1f));
        }

        [Test]
        public void AttackAndStagingShots_BeginExactlyOneLeadEarly_OtherCutsExactlyAtTheirTimestamps()
        {
            var scenario = MakeScenario();
            const float lead = ReconstructionCameraDirector.ActionLeadSeconds;
            const float justBefore = 0.001f;

            Assert.AreEqual(ReconstructionCameraMode.Interaction, ReconstructionCameraDirector.SelectShot(scenario, 20f - lead - justBefore).Mode);
            Assert.AreEqual(ReconstructionCameraMode.PhysicalAttack, ReconstructionCameraDirector.SelectShot(scenario, 20f - lead).Mode, "attack framing is up before the beat's first frame");

            Assert.AreEqual(ReconstructionCameraMode.PhysicalAttack, ReconstructionCameraDirector.SelectShot(scenario, 40f - justBefore).Mode);
            Assert.AreEqual(ReconstructionCameraMode.Overview, ReconstructionCameraDirector.SelectShot(scenario, 40f).Mode);

            Assert.AreEqual(ReconstructionCameraMode.Overview, ReconstructionCameraDirector.SelectShot(scenario, 70f - lead - justBefore).Mode);
            Assert.AreEqual(ReconstructionCameraMode.Interaction, ReconstructionCameraDirector.SelectShot(scenario, 70f - lead).Mode);

            Assert.AreEqual(ReconstructionCameraMode.Interaction, ReconstructionCameraDirector.SelectShot(scenario, 150f - justBefore).Mode);
            Assert.AreEqual(ReconstructionCameraMode.Discovery, ReconstructionCameraDirector.SelectShot(scenario, 150f).Mode, "discovery cuts on the discoverer's arrival, not before");
        }

        [Test]
        public void ActionLead_NeverReachesBackPastThePreviousEvent()
        {
            var scenario = MakeScenario();
            scenario.events[1].time = 0.4f;
            Assert.AreEqual(0f, ReconstructionCameraDirector.ShotStartTime(scenario, 1));
            Assert.AreEqual(ReconstructionCameraMode.PhysicalAttack, ReconstructionCameraDirector.SelectShot(scenario, 0f).Mode);

            var attackFirst = MakeScenario();
            attackFirst.events.RemoveAt(0);
            attackFirst.events[0].time = 0f;
            Assert.AreEqual(-ReconstructionCameraDirector.ActionLeadSeconds, ReconstructionCameraDirector.ShotStartTime(attackFirst, 0), "a first event has nothing before it to clamp to");
            Assert.AreEqual(ReconstructionCameraMode.PhysicalAttack, ReconstructionCameraDirector.SelectShot(attackFirst, 0f).Mode);
        }

        private static ReconstructionScenarioData MakeScenarioWithDeparture(float attackTime, float leaveTime)
        {
            var scenario = MakeScenario();
            scenario.events[1].time = attackTime;
            scenario.events[2].time = leaveTime;
            scenario.actors.Add(new ReconstructionActorData
            {
                visualId = "a",
                roleForReconstruction = "culprit",
                genericAppearance = "a",
                spawnTime = 0f,
                despawnTime = 80f,
                waypoints = new List<ReconstructionWaypointData>
                {
                    new() { time = 0f, slot = "interaction" },
                    new() { time = attackTime, slot = "crime_point" },
                    new() { time = leaveTime, slot = "exit" },
                    new() { time = 70f, slot = "interior_center" },
                },
            });
            return scenario;
        }

        [Test]
        public void DepartureShot_StartsWhenTheWalkToTheExitStarts()
        {
            var scenario = MakeScenarioWithDeparture(attackTime: 20f, leaveTime: 40f);
            var walkStart = 40f - ReconstructionActorTimeline.MaxWalkSeconds;
            Assert.AreEqual(walkStart, ReconstructionActorTimeline.WalkStartTime(scenario.actors[0], "generic", 40f), "precondition: an 8 s walk ends at the exit");
            Assert.AreEqual(walkStart, ReconstructionCameraDirector.ShotStartTime(scenario, 2));
            Assert.AreEqual(ReconstructionCameraMode.PhysicalAttack, ReconstructionCameraDirector.SelectShot(scenario, walkStart - 0.001f).Mode);
            Assert.AreEqual(ReconstructionCameraMode.Overview, ReconstructionCameraDirector.SelectShot(scenario, walkStart).Mode);

            var pose = ReconstructionActorTimeline.Evaluate(scenario.actors[0], scenario.events, "generic", walkStart + 0.5f);
            Assert.AreEqual("Walk", pose.animState, "the overview is up for the whole walk");
        }

        [Test]
        public void DepartureShot_NeverCutsIntoTheAttackBeatOrTheCollapse()
        {
            var scenario = MakeScenarioWithDeparture(attackTime: 20f, leaveTime: 22f);
            var beatEnd = 20f + ReconstructionActorTimeline.AttackBeatSeconds + ReconstructionActorTimeline.CollapseTransitionSeconds;
            Assert.AreEqual(22f, ReconstructionCameraDirector.ShotStartTime(scenario, 2), "a departure recorded before the collapse ends cuts at its own timestamp, never earlier");

            var later = MakeScenarioWithDeparture(attackTime: 20f, leaveTime: 25f);
            Assert.AreEqual(beatEnd, ReconstructionCameraDirector.ShotStartTime(later, 2));
        }

        [Test]
        public void ShotPlan_MatchesSelectShotEverywhere()
        {
            var scenario = MakeScenarioWithDeparture(attackTime: 20f, leaveTime: 40f);
            var plan = new ReconstructionCameraDirector.ShotPlan(scenario);
            for (var t = -2f; t <= scenario.durationSeconds + 2f; t += 0.05f)
            {
                Assert.AreEqual(ReconstructionCameraDirector.SelectShot(scenario, t), plan.ShotAt(t), $"t={t}");
            }
        }

        [Test]
        public void BetweenTwoCuts_TheShotNeverChanges()
        {
            var scenario = MakeScenarioWithDeparture(attackTime: 20f, leaveTime: 40f);
            var boundaries = new List<float>();
            for (var i = 0; i < scenario.events.Count; i++) boundaries.Add(ReconstructionCameraDirector.ShotStartTime(scenario, i));
            boundaries.Add(scenario.durationSeconds);
            for (var b = 0; b < boundaries.Count - 1; b++)
            {
                var first = ReconstructionCameraDirector.SelectShot(scenario, boundaries[b]);
                for (var t = boundaries[b]; t < boundaries[b + 1]; t += 0.1f)
                {
                    Assert.AreEqual(first, ReconstructionCameraDirector.SelectShot(scenario, t), $"t={t} between cuts at {boundaries[b]} and {boundaries[b + 1]}");
                }
            }
        }

        [Test]
        public void CutsAreRare_OneShotPerSemanticEvent()
        {
            var scenario = MakeScenario();
            var cuts = 0;
            var previous = ReconstructionCameraDirector.SelectShot(scenario, 0f);
            for (var t = 0f; t <= scenario.durationSeconds; t += 0.05f)
            {
                var shot = ReconstructionCameraDirector.SelectShot(scenario, t);
                if (!shot.Equals(previous)) cuts++;
                previous = shot;
            }
            Assert.AreEqual(scenario.events.Count - 1, cuts);
        }

        [Test]
        public void Controller_ShowsTheSelectedShot_AndSeekRestoresTheExactSameAttackCamera()
        {
            var (controller, overview, action) = MakeController();
            var scenario = MakeScenario("street");
            var attack = ReconstructionCameraDirector.SelectShot(scenario, 21f);

            controller.Apply(scenario, 21f);
            AssertShown(attack, overview, action, "first visit");
            var firstVisit = Snapshot(overview, action);

            foreach (var (before, label) in new[] { (5f, "before attack"), (151f, "discovery"), (45f, "departure"), (71f, "staging") })
            {
                controller.Apply(scenario, before);
                AssertShown(ReconstructionCameraDirector.SelectShot(scenario, before), overview, action, label);
                controller.Apply(scenario, 21f);
                Assert.AreEqual(firstVisit, Snapshot(overview, action), $"back to the attack after {label}: bit-identical camera");
            }
        }

        [TestCase(0.5f)]
        [TestCase(1f)]
        [TestCase(2f)]
        public void PlaybackSpeed_NeverChangesTheShotAtAGivenTruthTime(float speed)
        {
            var root = new GameObject("PlaybackRig");
            created.Add(root);
            var (controller, overview, action) = MakeController();
            var scene = root.AddComponent<ReconstructionSceneController>();
            scene.Configure(null, null, controller, null, null, null, null, null);
            var playback = root.AddComponent<ReconstructionPlaybackController>();
            playback.Configure(scene);
            var scenario = MakeScenario("parking");
            playback.Load(scenario);
            playback.SetSpeed(speed);
            playback.Play();

            // Exact binary steps, so every speed lands on the same truth times.
            const float truthStep = 0.25f;
            while (playback.IsPlaying && playback.CurrentTime < scenario.durationSeconds)
            {
                playback.Advance(truthStep / speed);
                AssertShown(ReconstructionCameraDirector.SelectShot(scenario, playback.CurrentTime), overview, action, $"speed {speed} t={playback.CurrentTime}");
            }
            Assert.AreEqual(scenario.durationSeconds, playback.CurrentTime);
        }

        [Test]
        public void LoadingAnotherScenario_PlacesTheCameraFromTheNewScenarioOnly()
        {
            var root = new GameObject("ScenarioSwitchRig");
            created.Add(root);
            var (controller, overview, action) = MakeController();
            var scene = root.AddComponent<ReconstructionSceneController>();
            scene.Configure(null, null, controller, null, null, null, null, null);

            var a = MakeScenario("street", "attack_firearm");
            scene.ApplyScenario(a);
            scene.Evaluate(21f);
            AssertShown(ReconstructionCameraDirector.SelectShot(a, 21f), overview, action, "scenario A attack");

            var b = MakeScenario("shop", "attack_administer_substance");
            scene.ApplyScenario(b);
            AssertShown(ReconstructionCameraDirector.SelectShot(b, 0f), overview, action, "scenario B at load");
            Assert.AreEqual(ReconstructionCameraMode.Interaction, controller.CurrentShot!.Value.Mode);

            scene.Evaluate(21f);
            var bAttack = ReconstructionCameraDirector.SelectShot(b, 21f);
            AssertShown(bAttack, overview, action, "scenario B attack");
            Assert.AreNotEqual(ReconstructionCameraDirector.SelectShot(a, 21f).Position, bAttack.Position, "nothing from A's framing survives");

            scene.ClearScenario();
            Assert.IsNull(controller.CurrentShot, "a cleared reconstruction holds no shot");
        }

        [Test]
        public void ResetShot_ReappliesAnIdenticalShotOnTheNextEvaluation()
        {
            var (controller, overview, action) = MakeController();
            var scenario = MakeScenario();
            controller.Apply(scenario, 21f);
            action.transform.position = new Vector3(99f, 99f, 99f);
            action.fieldOfView = 12f;

            controller.ResetShot();
            controller.Apply(scenario, 21f);

            AssertShown(ReconstructionCameraDirector.SelectShot(scenario, 21f), overview, action, "after reset");
        }

        [Test]
        public void TheOverview_IsTheUnchangedU52WorldSpaceShot_InEveryEnvironment()
        {
            var expected = new ReconstructionCameraShot(
                ReconstructionCameraMode.Overview,
                new Vector3(0f, 6.75f, -9.78f),
                Quaternion.LookRotation(new Vector3(0f, -0.7f, 1f).normalized, Vector3.up),
                55f);
            foreach (var env in new[] { "corridor", "parking", "shop", "street", "generic" })
            {
                Assert.AreEqual(expected, ReconstructionCameraDirector.SelectShot(MakeScenario(env), 45f), env);
            }
        }
    }
}
