using System.Collections.Generic;
using System.Linq;
using Caseline.Reconstruction;
using Caseline.ReconstructionEditor;
using NUnit.Framework;
using UnityEngine;

namespace Caseline.Reconstruction.Tests
{
    /// <summary>
    /// Phase U5.5 — the method × environment camera matrix and the real projected fixtures, measured by projection.
    /// The synthetic matrix substitutes environments to exercise framing; it makes no claim that these are generated
    /// cases. Each fixture set runs once per fixture.
    /// </summary>
    public class ReconstructionActionCameraMatrixTests
    {
        private static readonly string[] PhysicalActions = { "attack_strike", "attack_stab", "attack_strangle", "attack_firearm", "attack_push" };

        private static List<ReconstructionCameraMatrix.SampleResult> matrix;
        private static List<ReconstructionCameraMatrix.SampleResult> baseline;
        private static List<ReconstructionCameraMatrix.SampleResult> real;

        [OneTimeSetUp]
        public void MeasureOnce()
        {
            matrix = ReconstructionCameraMatrix.Run(ReconstructionCameraMatrix.DirectorSelector, includeRoleVariants: true);
            baseline = ReconstructionCameraMatrix.Run(ReconstructionCameraMatrix.U54Selector, includeRoleVariants: false);
            real = ReconstructionCameraMatrix.RunRealFixtures(ReconstructionCameraMatrix.DirectorSelector);
        }

        private static string Failures(IEnumerable<ReconstructionCameraMatrix.SampleResult> rows) =>
            string.Join("\n", rows.Where(r => !r.Passed).Take(20).Select(r => $"{r.Environment}/{r.Label}/{r.Sample.Name} [{r.Shot.Mode}]: {string.Join(", ", r.Problems)}"));

        private static ReconstructionCameraMatrix.SampleResult Row(List<ReconstructionCameraMatrix.SampleResult> rows, string env, string method, string sample) =>
            rows.Single(r => r.Environment == env && r.Label == method && r.Sample.Name == sample);

        [Test]
        public void Matrix_Covers7Methods_x_5Environments_WithRoleVariants_AtEveryBeat()
        {
            var combos = matrix.Select(r => (r.Environment, r.Label)).Distinct().ToList();
            Assert.AreEqual(5 * 7 * 3, combos.Count);
            foreach (var env in ReconstructionFramingReport.Environments)
            {
                foreach (var (method, _) in ReconstructionCameraMatrix.Methods)
                {
                    var samples = matrix.Where(r => r.Environment == env && r.Label == method).Select(r => r.Sample.Name).ToList();
                    CollectionAssert.AreEquivalent(new[] { "talk", "walk_to_attack", "attack_start", "attack_mid", "collapse", "walk_to_exit", "departure", "staging", "discovery" }, samples, $"{env}/{method}");
                }
            }
        }

        [Test]
        public void Matrix_EveryActiveBeat_FramesItsPeople_Unclipped_Unoccluded_Separated_WithLabels()
        {
            var failing = matrix.Where(r => !r.Passed).ToList();
            Assert.IsEmpty(failing, Failures(failing));
        }

        [Test]
        public void RealProjectedFixtures_EveryActiveBeat_FramesItsPeople()
        {
            Assert.AreEqual(8, real.Select(r => r.Label).Distinct().Count(), "7 method fixtures + the POC");
            var failing = real.Where(r => !r.Passed).ToList();
            Assert.IsEmpty(failing, Failures(failing));
        }

        [Test]
        public void EveryMethodInEveryEnvironment_SelectsItsSafeShot()
        {
            foreach (var env in ReconstructionFramingReport.Environments)
            {
                foreach (var (method, action) in ReconstructionCameraMatrix.Methods)
                {
                    var expectedAttack = PhysicalActions.Contains(action) ? "PhysicalAttack" : "Interaction";
                    Assert.AreEqual("Interaction", Row(matrix, env, method, "talk").Shot.Mode, $"{env}/{method} talk");
                    Assert.AreEqual(expectedAttack, Row(matrix, env, method, "attack_start").Shot.Mode, $"{env}/{method} attack framing is up on the beat's first frame");
                    Assert.AreEqual(expectedAttack, Row(matrix, env, method, "collapse").Shot.Mode, $"{env}/{method} collapse stays in the attack's shot");
                    Assert.AreEqual("Overview", Row(matrix, env, method, "walk_to_exit").Shot.Mode, $"{env}/{method} the departure walk is in the overview");
                    Assert.AreEqual("Overview", Row(matrix, env, method, "departure").Shot.Mode, $"{env}/{method} departure");
                    Assert.AreEqual("Interaction", Row(matrix, env, method, "staging").Shot.Mode, $"{env}/{method} staging");
                    Assert.AreEqual("Discovery", Row(matrix, env, method, "discovery").Shot.Mode, $"{env}/{method} discovery");
                }
            }
        }

        [Test]
        public void AttackReadability_IsMeasurablyBetterThanU54_InEveryEnvironment()
        {
            foreach (var env in ReconstructionFramingReport.Environments)
            {
                foreach (var (method, action) in ReconstructionCameraMatrix.Methods.Where(m => PhysicalActions.Contains(m.action)))
                {
                    var before = Row(baseline, env, method, "attack_mid");
                    var after = Row(matrix, env, method, "attack_mid");
                    var label = $"{env}/{method}";
                    // The smaller of the two people on screen is what limits readability, whichever of them it is.
                    var smallestBefore = Mathf.Min(before.AttackerOccupancy, before.VictimOccupancy);
                    var smallestAfter = Mathf.Min(after.AttackerOccupancy, after.VictimOccupancy);
                    Assert.GreaterOrEqual(smallestAfter, smallestBefore * 1.2f, $"{label}: the smaller figure at least 20% taller on screen ({smallestBefore:P1} -> {smallestAfter:P1})");
                    Assert.Greater(after.AttackerOccupancy, before.AttackerOccupancy, $"{label}: attacker taller on screen");
                    Assert.Greater(after.VictimOccupancy, before.VictimOccupancy, $"{label}: victim taller on screen");
                    Assert.Greater(after.CombinedHeight, before.CombinedHeight, $"{label}: combined framing");
                    Assert.GreaterOrEqual(after.SilhouetteGap, before.SilhouetteGap, $"{label}: the two people stay at least as separate on screen");
                    Assert.Less(after.FrameWidthMeters, before.FrameWidthMeters, $"{label}: tighter than the U5.4 shot");
                }
            }

            var reachBefore = Median(baseline.Where(r => r.Sample.Name == "attack_mid").Select(r => r.Reach));
            var reachAfter = Median(matrix.Where(r => r.Sample.Name == "attack_mid" && PhysicalActions.Contains(r.Action)).Select(r => r.Reach));
            Assert.Greater(reachAfter, reachBefore * 1.2f, "a forward beat reads longer on screen than it did");
        }

        [Test]
        public void Framing_StaysNeutral_ReadableButNeverACloseUp_AndKeepsTheScene()
        {
            foreach (var r in matrix.Where(r => ReconstructionCameraMatrix.Methods.Any(m => m.method == r.Label)))
            {
                var label = $"{r.Environment}/{r.Label}/{r.Sample.Name}";
                switch (r.Sample.Name)
                {
                    case "attack_mid" when PhysicalActions.Contains(r.Action):
                        Assert.That(r.AttackerOccupancy, Is.InRange(0.22f, 0.38f), label);
                        Assert.GreaterOrEqual(r.FrameWidthMeters, 7f, $"{label}: enough of the environment around the attack");
                        break;
                    case "attack_mid":
                    case "talk":
                        Assert.That(r.AttackerOccupancy, Is.InRange(0.18f, 0.30f), label);
                        Assert.GreaterOrEqual(r.FrameWidthMeters, 8.5f, label);
                        break;
                    case "discovery":
                        var discoverer = r.Actors.Single(a => a.Relevant && a.Visible && !a.Shot.lying);
                        Assert.That(discoverer.Shot.occupancy, Is.InRange(0.18f, 0.32f), label);
                        Assert.GreaterOrEqual(r.FrameWidthMeters, 8.5f, $"{label}: the scene still reads as a place, later");
                        break;
                    case "departure":
                        Assert.GreaterOrEqual(r.AttackerOccupancy, 0.12f, label);
                        break;
                }
            }
        }

        [Test]
        public void NeutralInteraction_IsNeverFramedTighterThanAPhysicalAttack_AndPoisoningMatchesStagedOverdose()
        {
            foreach (var env in ReconstructionFramingReport.Environments)
            {
                var interaction = ReconstructionCameraPresets.FramingFor(env, ReconstructionCameraMode.Interaction);
                var attack = ReconstructionCameraPresets.FramingFor(env, ReconstructionCameraMode.PhysicalAttack);
                Assert.Greater(interaction.Distance, attack.Distance, env);
                Assert.GreaterOrEqual(interaction.FieldOfView, attack.FieldOfView, env);

                var poisoning = Row(matrix, env, "poisoning", "attack_mid").Shot;
                var overdose = Row(matrix, env, "staged_overdose", "attack_mid").Shot;
                Assert.AreEqual(poisoning.Position, overdose.Position, $"{env}: no fabricated visual distinction");
                Assert.AreEqual(poisoning.Rotation, overdose.Rotation, env);
                Assert.AreEqual(poisoning.FieldOfView, overdose.FieldOfView, env);
            }
        }

        [Test]
        public void Firearm_SharesThePhysicalAttackFraming_NeverATighterShotImplyingDistance()
        {
            foreach (var env in ReconstructionFramingReport.Environments)
            {
                var firearm = Row(matrix, env, "firearm", "attack_mid").Shot;
                foreach (var method in new[] { "blunt_force", "stabbing", "strangulation", "fall_push" })
                {
                    var other = Row(matrix, env, method, "attack_mid").Shot;
                    Assert.AreEqual(other.Position, firearm.Position, $"{env}/{method}");
                    Assert.AreEqual(other.FieldOfView, firearm.FieldOfView, $"{env}/{method}");
                }
            }
        }

        [Test]
        public void Strangulation_BothSilhouettesStaySeparable()
        {
            foreach (var env in ReconstructionFramingReport.Environments)
            {
                foreach (var sample in new[] { "attack_start", "attack_mid" })
                {
                    Assert.Greater(Row(matrix, env, "strangulation", sample).SilhouetteGap, 0.02f, $"{env}/{sample}");
                }
            }
        }

        [Test]
        public void StreetRegression_EveryShotInTheStreet_FramesEveryoneItMustShow()
        {
            var street = matrix.Where(r => r.Environment == "street").ToList();
            Assert.AreEqual(7 * 3 * 9, street.Count);
            Assert.IsEmpty(street.Where(r => !r.Passed), Failures(street));
            CollectionAssert.IsSupersetOf(street.Select(r => r.Shot.Mode).Distinct(), new[] { "Overview", "Interaction", "PhysicalAttack", "Discovery" });
        }

        [TestCase("generic")]
        [TestCase("parking")]
        public void Scenery_NeverHidesAnyoneAtAnActiveBeat_NorStandsNearTheLens(string env)
        {
            foreach (var r in matrix.Where(r => r.Environment == env && r.Sample.Active))
            {
                foreach (var a in r.Actors.Where(a => a.Visible && a.Relevant))
                {
                    Assert.AreEqual(0, a.Shot.occludedSamples, $"{env}/{r.Label}/{r.Sample.Name}/{a.Role}");
                }
            }

            foreach (var shot in AllSlotShots(env))
            {
                foreach (var box in ReconstructionEnvironmentController.OccluderBounds(env).Skip(4)) // the four boundary walls come first
                {
                    Assert.Greater(Mathf.Sqrt(box.SqrDistance(shot.Position)), 1.5f, $"{env}/{shot.Mode}: a prop right beside the lens would fill the frame's edge");
                }
            }
        }

        [Test]
        public void EverySlotShot_StandsInsideTheEnvironment_AndOutsideEveryProp()
        {
            foreach (var env in ReconstructionFramingReport.Environments)
            {
                foreach (var shot in AllSlotShots(env))
                {
                    Assert.Less(Mathf.Abs(shot.Position.x), 7.5f, $"{env}/{shot.Mode} x");
                    Assert.Less(Mathf.Abs(shot.Position.z), 7.5f, $"{env}/{shot.Mode} z");
                    Assert.That(shot.Position.y, Is.InRange(1.2f, 3f), $"{env}/{shot.Mode}: a standing observer's eye line, not a crane or a floor shot");
                    foreach (var box in ReconstructionEnvironmentController.OccluderBounds(env))
                    {
                        var padded = box;
                        padded.Expand(0.4f);
                        Assert.IsFalse(padded.Contains(shot.Position), $"{env}/{shot.Mode} inside scenery");
                    }
                }
            }
        }

        /// <summary>Every slot shot an event can select: the projector stages talk at interaction, the attack and the
        /// discovery at crime_point, and staging at interior_center.</summary>
        private static IEnumerable<ReconstructionCameraShot> AllSlotShots(string env)
        {
            yield return ReconstructionCameraPresets.Shot(env, ReconstructionCameraMode.Interaction, "interaction");
            yield return ReconstructionCameraPresets.Shot(env, ReconstructionCameraMode.Interaction, "crime_point");
            yield return ReconstructionCameraPresets.Shot(env, ReconstructionCameraMode.Interaction, "interior_center");
            yield return ReconstructionCameraPresets.Shot(env, ReconstructionCameraMode.PhysicalAttack, "crime_point");
            yield return ReconstructionCameraPresets.Shot(env, ReconstructionCameraMode.Discovery, "crime_point");
        }

        [Test]
        public void Discovery_ShowsTheWholeBodyAndTheDiscoverer_WithTheAttackerGone()
        {
            foreach (var r in matrix.Concat(real).Where(r => r.Sample.Name == "discovery"))
            {
                var label = $"{r.Environment}/{r.Label}";
                var body = r.Actors.Single(a => a.Relevant && a.Visible && a.Shot.lying);
                Assert.IsTrue(body.Shot.extentsInFrame && body.Shot.headInFrame && body.Shot.feetInFrame, $"{label}: body fully in frame");
                Assert.AreEqual(0, body.Shot.occludedSamples, $"{label}: body unoccluded");
                var discoverer = r.Actors.Single(a => a.Relevant && a.Visible && !a.Shot.lying);
                Assert.IsTrue(discoverer.Shot.extentsInFrame, $"{label}: discoverer fully in frame");
                Assert.IsFalse(r.Actors.Any(a => a.Visible && !a.Relevant && a.Role == "culprit"), $"{label}: culprit absent");
            }
        }

        [Test]
        public void RealFixtures_CutRarely_OnceOrLessPerSemanticEvent_NeverBackAndForthWithinSeconds()
        {
            foreach (var file in ReconstructionCameraMatrix.RealMethodFixtures)
            {
                var scenario = ReconstructionCameraMatrix.LoadFixture(file);
                var cutTimes = new List<float>();
                var previous = ReconstructionCameraDirector.SelectShot(scenario, 0f);
                for (var t = 0f; t <= scenario.durationSeconds; t += 0.25f)
                {
                    var shot = ReconstructionCameraDirector.SelectShot(scenario, t);
                    if (shot.Equals(previous)) continue;
                    cutTimes.Add(t);
                    previous = shot;
                }
                Assert.LessOrEqual(cutTimes.Count, scenario.events.Count - 1, file);
                for (var i = 2; i < cutTimes.Count; i++)
                {
                    Assert.Greater(cutTimes[i] - cutTimes[i - 2], 4f, $"{file}: three shots within four seconds at {cutTimes[i - 2]}s");
                }
            }
        }

        [Test]
        public void ShotSelection_IgnoresIdentityAndRole_OnlyPresentationDataMatters()
        {
            foreach (var file in ReconstructionCameraMatrix.RealMethodFixtures)
            {
                var original = ReconstructionCameraMatrix.LoadFixture(file);
                var disguised = ReconstructionCameraMatrix.LoadFixture(file);
                foreach (var actor in disguised.actors)
                {
                    var renamed = "x_" + actor.visualId.GetHashCode().ToString("x");
                    foreach (var e in disguised.events)
                    {
                        if (e.actorVisualId == actor.visualId) e.actorVisualId = renamed;
                        if (e.counterpartyVisualId == actor.visualId) e.counterpartyVisualId = renamed;
                    }
                    actor.visualId = renamed;
                    actor.roleForReconstruction = "unnamed";
                }
                disguised.caseId = "some-other-case";

                foreach (var sample in ReconstructionCameraMatrix.SamplesFor(original))
                {
                    var a = ReconstructionCameraDirector.SelectShot(original, sample.Time);
                    var b = ReconstructionCameraDirector.SelectShot(disguised, sample.Time);
                    Assert.AreEqual(a.Mode, b.Mode, $"{file}/{sample.Name}");
                    Assert.AreEqual(a.FieldOfView, b.FieldOfView, $"{file}/{sample.Name}");
                    Assert.AreEqual(a.Rotation, b.Rotation, $"{file}/{sample.Name}");
                }
            }
        }

        [Test]
        public void CameraWork_NeverChangesActorScale()
        {
            Assert.AreEqual(1.78f, ReconstructionFramingMeasurement.ActorHeightMeters);

            var created = new List<GameObject>();
            try
            {
                var template = new GameObject("ScaleTemplate");
                template.AddComponent<ReconstructionActorController>();
                var actorsRoot = new GameObject("Actors");
                var overview = new GameObject("Overview").AddComponent<Camera>();
                var action = new GameObject("Action").AddComponent<Camera>();
                var cameraRig = new GameObject("CameraRig").AddComponent<ReconstructionCameraController>();
                cameraRig.Configure(overview, action);
                var sceneGo = new GameObject("Scene");
                created.AddRange(new[] { template, actorsRoot, overview.gameObject, action.gameObject, cameraRig.gameObject, sceneGo });
                var scene = sceneGo.AddComponent<ReconstructionSceneController>();
                scene.Configure(actorsRoot.transform, null, cameraRig, template, null, null, null, null);

                foreach (var file in new[] { "reconstruction-method-firearm.json", "reconstruction-method-poisoning.json" })
                {
                    var scenario = ReconstructionCameraMatrix.LoadFixture(file);
                    scene.ApplyScenario(scenario);
                    foreach (var sample in ReconstructionCameraMatrix.SamplesFor(scenario))
                    {
                        scene.Evaluate(sample.Time);
                        Assert.IsNotEmpty(scene.SpawnedActors);
                        foreach (var actor in scene.SpawnedActors)
                        {
                            Assert.AreEqual(Vector3.one, actor.transform.localScale, $"{file}/{sample.Name}");
                        }
                    }
                    scene.ClearScenario();
                }
            }
            finally
            {
                foreach (var go in created)
                {
                    if (go != null) Object.DestroyImmediate(go);
                }
            }
        }

        private static float Median(IEnumerable<float> values)
        {
            var sorted = values.OrderBy(v => v).ToList();
            var mid = sorted.Count / 2;
            return sorted.Count % 2 == 0 ? (sorted[mid - 1] + sorted[mid]) / 2f : sorted[mid];
        }
    }
}
