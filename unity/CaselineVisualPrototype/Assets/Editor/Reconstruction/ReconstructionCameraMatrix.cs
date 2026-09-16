using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using Caseline.Reconstruction;
using UnityEditor;
using UnityEngine;

namespace Caseline.ReconstructionEditor
{
    /// <summary>
    /// Visual camera QA matrix: every CrimeMethod in every environment kind, measured by projection at each semantic
    /// beat. The matrix scenarios are SYNTHETIC — the event shape the projector emits (talk, attack, leave_scene,
    /// stage_scene, discover) with the environment substituted — so they exercise framing, never case truth. The
    /// same measurement runs on the REAL projected method fixtures in StreamingAssets.
    /// </summary>
    public static class ReconstructionCameraMatrix
    {
        public static readonly (string method, string action)[] Methods =
        {
            ("blunt_force", "attack_strike"),
            ("stabbing", "attack_stab"),
            ("strangulation", "attack_strangle"),
            ("firearm", "attack_firearm"),
            ("fall_push", "attack_push"),
            ("poisoning", "attack_administer_substance"),
            ("staged_overdose", "attack_administer_substance"),
        };

        public static readonly string[] RealMethodFixtures =
        {
            "reconstruction-method-blunt-force.json",
            "reconstruction-method-stabbing.json",
            "reconstruction-method-strangulation.json",
            "reconstruction-method-firearm.json",
            "reconstruction-method-fall-push.json",
            "reconstruction-method-poisoning.json",
            "reconstruction-method-staged-overdose.json",
            "reconstruction-poc-real.json",
        };

        public const float TalkTime = 0f;
        public const float AttackTime = 30f;
        public const float LeaveTime = 60f;
        public const float StageTime = 90f;
        public const float DiscoverTime = 150f;
        public const float Duration = 200f;

        private const string Culprit = "c";
        private const string Victim = "v";
        private const string Discoverer = "d";
        private const string Bystander = "p";

        public readonly struct ShotSpec
        {
            public readonly string Mode;
            public readonly Vector3 Position;
            public readonly Quaternion Rotation;
            public readonly float FieldOfView;

            public ShotSpec(string mode, Vector3 position, Quaternion rotation, float fieldOfView)
            {
                Mode = mode;
                Position = position;
                Rotation = rotation;
                FieldOfView = fieldOfView;
            }
        }

        public delegate ShotSpec ShotSelector(ReconstructionScenarioData scenario, float time);

        /// <summary>Who must read at a beat: the attack's two people (plus anyone else standing there for a talk or
        /// the attack itself), the body and whoever finds it, or the figure staging the scene.</summary>
        public enum Focus { EveryoneVisible, AttackerAndVictim, Attacker, DiscovererAndBody }

        /// <summary>A beat to measure: when, who must read, and whether it is an active semantic action (where nothing
        /// relevant may be clipped or hidden) or a transitional moment reported for information only.</summary>
        public readonly struct Sample
        {
            public readonly string Name;
            public readonly float Time;
            public readonly bool Active;
            public readonly Focus Focus;

            public Sample(string name, float time, bool active, Focus focus)
            {
                Name = name;
                Time = time;
                Active = active;
                Focus = focus;
            }
        }

        /// <summary>The beats of any projector-shaped scenario, placed from its own event times.</summary>
        public static List<Sample> SamplesFor(ReconstructionScenarioData scenario)
        {
            var samples = new List<Sample>();
            foreach (var e in scenario.events)
            {
                switch (e.type)
                {
                    case "talk":
                        samples.Add(new Sample("talk", e.time + 1.5f, true, Focus.EveryoneVisible));
                        break;
                    case "attack":
                        samples.Add(new Sample("walk_to_attack", e.time - 4f, false, Focus.AttackerAndVictim));
                        samples.Add(new Sample("attack_start", e.time, true, Focus.EveryoneVisible));
                        samples.Add(new Sample("attack_mid", e.time + ReconstructionActorTimeline.AttackBeatSeconds * 0.5f, true, Focus.EveryoneVisible));
                        samples.Add(new Sample("collapse", e.time + ReconstructionActorTimeline.AttackBeatSeconds + ReconstructionActorTimeline.CollapseTransitionSeconds + 0.5f, true, Focus.AttackerAndVictim));
                        break;
                    case "leave_scene":
                        samples.Add(new Sample("walk_to_exit", e.time - 3f, false, Focus.AttackerAndVictim));
                        samples.Add(new Sample("departure", e.time + 0.5f, true, Focus.AttackerAndVictim));
                        break;
                    case "stage_scene":
                        samples.Add(new Sample("staging", e.time + 1f, true, Focus.Attacker));
                        break;
                    case "discover":
                        samples.Add(new Sample("discovery", e.time + 1f, true, Focus.DiscovererAndBody));
                        break;
                }
            }
            return samples;
        }

        /// <summary>One synthetic scenario in the projector's event shape. `presentRole` adds a third person present
        /// at the talk and the attack (an accomplice or an unnamed person); `discovererRole` is who finds the body.</summary>
        public static ReconstructionScenarioData BuildScenario(string environment, string safeVisualAction, string discovererRole = "unnamed", string presentRole = null)
        {
            var scenario = new ReconstructionScenarioData
            {
                version = ReconstructionSchema.SupportedVersion,
                caseId = $"camera-matrix-{environment}-{safeVisualAction}",
                environment = environment,
                durationSeconds = Duration,
            };
            scenario.actors.Add(Actor(Culprit, "culprit", 0f, StageTime + 10f, (TalkTime, "interaction"), (AttackTime, "crime_point"), (LeaveTime, "exit"), (StageTime, "interior_center")));
            scenario.actors.Add(Actor(Victim, "victim", 0f, Duration, (TalkTime, "interaction"), (AttackTime, "crime_point")));
            scenario.actors.Add(Actor(Discoverer, discovererRole, DiscoverTime, Duration, (DiscoverTime, "crime_point")));
            if (presentRole != null) scenario.actors.Add(Actor(Bystander, presentRole, TalkTime, AttackTime + 10f, (TalkTime, "interaction"), (AttackTime, "crime_point")));

            scenario.events.Add(new ReconstructionEventData { time = TalkTime, type = "talk", actorVisualId = Culprit, counterpartyVisualId = Victim, locationSlot = "interaction" });
            scenario.events.Add(new ReconstructionEventData { time = AttackTime, type = "attack", actorVisualId = Culprit, counterpartyVisualId = Victim, locationSlot = "crime_point", safeVisualAction = safeVisualAction });
            scenario.events.Add(new ReconstructionEventData { time = LeaveTime, type = "leave_scene", actorVisualId = Culprit, locationSlot = "exit" });
            scenario.events.Add(new ReconstructionEventData { time = StageTime, type = "stage_scene", actorVisualId = Culprit, locationSlot = "interior_center", safeVisualAction = "manipulate_scene" });
            scenario.events.Add(new ReconstructionEventData { time = DiscoverTime, type = "discover", actorVisualId = Discoverer, locationSlot = "crime_point" });
            return scenario;
        }

        private static ReconstructionActorData Actor(string id, string role, float spawn, float despawn, params (float time, string slot)[] waypoints)
        {
            var actor = new ReconstructionActorData { visualId = id, roleForReconstruction = role, genericAppearance = "a", spawnTime = spawn, despawnTime = despawn };
            foreach (var (time, slot) in waypoints) actor.waypoints.Add(new ReconstructionWaypointData { time = time, slot = slot });
            return actor;
        }

        public static ReconstructionScenarioData LoadFixture(string fileName)
        {
            var path = Path.Combine(Application.dataPath, "StreamingAssets", fileName);
            if (!ReconstructionJsonLoader.TryLoad(File.ReadAllText(path), out var scenario, out var error))
            {
                throw new InvalidDataException($"{fileName}: {error}");
            }
            return scenario;
        }

        public struct ActorResult
        {
            public string VisualId;
            public string Role;
            public bool Visible;
            public bool Relevant;
            public string AnimState;
            public ReconstructionFramingMeasurement.ActorShot Shot;
        }

        public struct SampleResult
        {
            public string Environment;
            public string Label;
            public string Action;
            public Sample Sample;
            public ShotSpec Shot;
            public List<ActorResult> Actors;
            public float AttackerOccupancy;
            public float VictimOccupancy;
            public float CombinedHeight;
            public float SilhouetteGap;
            public float Reach;
            public float FrameWidthMeters;
            public List<string> Problems;

            public bool Passed => Problems.Count == 0;
        }

        /// <summary>Evaluates the real actor poses at a sample time, points a measurement camera where the selector
        /// says, and measures every visible actor. Problems are only raised for relevant actors at active beats.</summary>
        public static SampleResult Measure(Camera camera, ReconstructionScenarioData scenario, Sample sample, ShotSelector selector, string label)
        {
            var shot = selector(scenario, sample.Time);
            camera.transform.SetPositionAndRotation(shot.Position, shot.Rotation);
            camera.fieldOfView = shot.FieldOfView;
            camera.aspect = ReconstructionFramingMeasurement.ViewerAspect;
            camera.nearClipPlane = 0.1f;
            camera.farClipPlane = 100f;

            var occluders = ReconstructionEnvironmentController.OccluderBounds(scenario.environment);
            var attack = scenario.events.First(e => e.type == "attack");
            var discover = scenario.events.FirstOrDefault(e => e.type == "discover");
            var result = new SampleResult
            {
                Environment = scenario.environment,
                Label = label,
                Action = attack.safeVisualAction,
                Sample = sample,
                Shot = shot,
                Actors = new List<ActorResult>(),
                Problems = new List<string>(),
            };

            foreach (var actor in scenario.actors)
            {
                var pose = ReconstructionActorTimeline.Evaluate(actor, scenario.events, scenario.environment, sample.Time);
                var isAttacker = actor.visualId == attack.actorVisualId;
                var isVictim = actor.visualId == attack.counterpartyVisualId;
                var entry = new ActorResult
                {
                    VisualId = actor.visualId,
                    Role = actor.roleForReconstruction,
                    Visible = pose.visible,
                    AnimState = pose.animState,
                    Relevant = sample.Focus switch
                    {
                        Focus.EveryoneVisible => true,
                        Focus.AttackerAndVictim => isAttacker || isVictim,
                        Focus.Attacker => isAttacker,
                        _ => isVictim || (discover != null && actor.visualId == discover.actorVisualId),
                    },
                };
                if (pose.visible)
                {
                    var lying = pose.animState == "Collapse" && pose.normalizedTime >= 1f;
                    entry.Shot = ReconstructionFramingMeasurement.MeasureActor(camera, pose.position, pose.facing, lying, occluders);
                    if (isAttacker) result.Reach = ReconstructionFramingMeasurement.ReachScreenLength(camera, pose.position, pose.facing);
                }
                result.Actors.Add(entry);

                if (!entry.Relevant) continue;
                var mustBeOnScreen = sample.Focus != Focus.EveryoneVisible || isAttacker || isVictim;
                if (sample.Active && !pose.visible && mustBeOnScreen) result.Problems.Add($"{actor.roleForReconstruction} not visible");
                if (!sample.Active || !pose.visible) continue;
                if (entry.Shot.behindCamera) result.Problems.Add($"{actor.roleForReconstruction} behind camera");
                if (!entry.Shot.extentsInFrame) result.Problems.Add($"{actor.roleForReconstruction} clipped");
                if (entry.Shot.occludedSamples > 0) result.Problems.Add($"{actor.roleForReconstruction} occluded {entry.Shot.occludedSamples}/{entry.Shot.occlusionSampleCount}");
                if (!entry.Shot.labelInFrame) result.Problems.Add($"{actor.roleForReconstruction} label off-frame");
            }

            var relevantRects = result.Actors.Where(a => a.Relevant && a.Visible).Select(a => a.Shot.coreViewport).ToList();
            if (relevantRects.Count > 0)
            {
                var union = relevantRects.Aggregate((a, b) => Rect.MinMaxRect(Mathf.Min(a.xMin, b.xMin), Mathf.Min(a.yMin, b.yMin), Mathf.Max(a.xMax, b.xMax), Mathf.Max(a.yMax, b.yMax)));
                result.CombinedHeight = union.height;
            }

            var attacker = result.Actors.FirstOrDefault(a => a.VisualId == attack.actorVisualId);
            var victim = result.Actors.FirstOrDefault(a => a.VisualId == attack.counterpartyVisualId);
            if (attacker.Visible) result.AttackerOccupancy = attacker.Shot.occupancy;
            if (victim.Visible) result.VictimOccupancy = victim.Shot.occupancy;
            if (attacker.Visible && victim.Visible)
            {
                result.SilhouetteGap = ReconstructionFramingMeasurement.HorizontalGap(attacker.Shot.coreViewport, victim.Shot.coreViewport);
                var twoPersonBeat = sample.Name == "talk" || sample.Name == "attack_start" || sample.Name == "attack_mid";
                if (sample.Active && twoPersonBeat && result.SilhouetteGap <= 0f) result.Problems.Add("attacker and victim silhouettes overlap");
            }
            if (sample.Name == "discovery" && attacker.Visible) result.Problems.Add("attacker still present at discovery");

            var focusSlot = sample.Name switch
            {
                "talk" or "walk_to_attack" => "interaction",
                "departure" or "walk_to_exit" => "exit",
                "staging" => "interior_center",
                _ => "crime_point",
            };
            result.FrameWidthMeters = ReconstructionFramingMeasurement.FrameWidthAtPoint(camera, ReconstructionZoneLayout.GetZonePosition(scenario.environment, focusSlot) + Vector3.up);
            return result;
        }

        public static List<SampleResult> MeasureScenario(Camera camera, ReconstructionScenarioData scenario, ShotSelector selector, string label)
        {
            return SamplesFor(scenario).Select(s => Measure(camera, scenario, s, selector, label)).ToList();
        }

        /// <summary>Every (environment, method) scenario measured at every beat; with role variants, again with a
        /// third person present at the talk and the attack, and each kind of discoverer.</summary>
        public static List<SampleResult> Run(ShotSelector selector, bool includeRoleVariants)
        {
            return WithCamera(camera =>
            {
                var results = new List<SampleResult>();
                foreach (var env in ReconstructionFramingReport.Environments)
                {
                    foreach (var (method, action) in Methods)
                    {
                        results.AddRange(MeasureScenario(camera, BuildScenario(env, action), selector, method));
                        if (!includeRoleVariants) continue;
                        foreach (var (discoverer, present) in new[] { ("accomplice", "unnamed"), ("unnamed", "accomplice") })
                        {
                            results.AddRange(MeasureScenario(camera, BuildScenario(env, action, discoverer, present), selector, $"{method}+{present}-present+{discoverer}-discoverer"));
                        }
                    }
                }
                return results;
            });
        }

        public static List<SampleResult> RunRealFixtures(ShotSelector selector)
        {
            return WithCamera(camera => RealMethodFixtures.SelectMany(f => MeasureScenario(camera, LoadFixture(f), selector, f)).ToList());
        }

        private static T WithCamera<T>(Func<Camera, T> body)
        {
            var camera = new GameObject("CameraMatrixMeasurement").AddComponent<Camera>();
            camera.enabled = false;
            try
            {
                return body(camera);
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(camera.gameObject);
            }
        }

        // ---- U5.4 camera, frozen here as the measured baseline (the runtime no longer carries it) ----

        public static readonly Vector3 U54OverviewPosition = new(0f, 6.75f, -9.78f);
        public static readonly Vector3 U54OverviewDirection = new Vector3(0f, -0.7f, 1f).normalized;
        public const float U54OverviewFieldOfView = 55f;
        public static readonly Vector3 U54ClosePosition = new(-3.71f, 2.5f, -5.51f);
        public static readonly Vector3 U54CloseDirection = new Vector3(3.71f, -1.85f, 6.42f).normalized;
        public const float U54CloseFieldOfView = 50f;

        public static ShotSpec U54Selector(ReconstructionScenarioData scenario, float time)
        {
            ReconstructionEventData current = null;
            foreach (var e in scenario.events)
            {
                if (e.time > time) break;
                current = e;
            }
            var close = current != null && (current.locationSlot == "interaction" || current.locationSlot == "crime_point");
            return close
                ? new ShotSpec("close", U54ClosePosition, Quaternion.LookRotation(U54CloseDirection, Vector3.up), U54CloseFieldOfView)
                : new ShotSpec("overview", U54OverviewPosition, Quaternion.LookRotation(U54OverviewDirection, Vector3.up), U54OverviewFieldOfView);
        }

        public static ShotSpec DirectorSelector(ReconstructionScenarioData scenario, float time)
        {
            var shot = ReconstructionCameraDirector.SelectShot(scenario, time);
            return new ShotSpec(shot.Mode.ToString(), shot.Position, shot.Rotation, shot.FieldOfView);
        }

        // ---- reporting ----

        [MenuItem("Tools/CASELINE/Report Reconstruction Camera Matrix (U5.4 baseline)")]
        public static void ReportBaseline() => WriteReport("U5.4 baseline", U54Selector, "ReconstructionCameraBaseline.txt");

        [MenuItem("Tools/CASELINE/Report Reconstruction Camera Matrix (U5.5 action cameras)")]
        public static void ReportActionCameras() => WriteReport("U5.5 action cameras", DirectorSelector, "ReconstructionCameraU55.txt");

        public static void ReportBoth()
        {
            ReportBaseline();
            ReportActionCameras();
        }

        public static void WriteReport(string title, ShotSelector selector, string fileName)
        {
            var results = Run(selector, includeRoleVariants: true);
            var real = RunRealFixtures(selector);
            var report = new StringBuilder();
            report.AppendLine($"=== Reconstruction camera matrix: {title} (aspect {ReconstructionFramingMeasurement.ViewerAspect}) ===");
            AppendDetail(report, results);
            AppendSummaries(report, results);
            report.AppendLine();
            report.AppendLine("=== REAL PROJECTED fixtures ===");
            AppendDetail(report, real);
            AppendCuts(report, selector);
            report.AppendLine($"[CAM-TOTAL] synthetic samples={results.Count} failing={results.Count(r => !r.Passed)}; real samples={real.Count} failing={real.Count(r => !r.Passed)}");
            foreach (var group in results.Concat(real).Where(r => !r.Passed).SelectMany(r => r.Problems.Select(p => $"{r.Sample.Name}: {p}")).GroupBy(p => p).OrderByDescending(g => g.Count()))
            {
                report.AppendLine($"[CAM-PROBLEM] {group.Count()}x {group.Key}");
            }
            var path = ReportPath(fileName);
            File.WriteAllText(path, report.ToString());
            Debug.Log($"[Reconstruction] camera matrix report ({title}) written to {path}: synthetic {results.Count(r => !r.Passed)}/{results.Count} failing, real {real.Count(r => !r.Passed)}/{real.Count} failing");
        }

        public static string ReportPath(string fileName)
        {
            var dir = Environment.GetEnvironmentVariable("CASELINE_REPORT_DIR");
            if (string.IsNullOrEmpty(dir)) dir = Path.Combine(Directory.GetParent(Application.dataPath)!.FullName, "Temp");
            Directory.CreateDirectory(dir);
            return Path.Combine(dir, fileName);
        }

        private static void AppendDetail(StringBuilder report, List<SampleResult> results)
        {
            report.AppendLine("[CAM] env | label | sample@t | shot | actors (role occ ext head feet label occl) | attacker | victim | combinedH | gap | reach | frameW | result");
            foreach (var r in results)
            {
                var actors = string.Join("; ", r.Actors.Where(a => a.Visible).Select(a =>
                    $"{a.Role}{(a.Shot.lying ? "(lying)" : "")}{(a.Relevant ? "" : "(bg)")} occ={Pct(a.Shot.occupancy)} ext={Ok(a.Shot.extentsInFrame)} head={Ok(a.Shot.headInFrame)} feet={Ok(a.Shot.feetInFrame)} label={Ok(a.Shot.labelInFrame)} occl={a.Shot.occludedSamples}/{a.Shot.occlusionSampleCount}"));
                report.AppendLine($"[CAM] {r.Environment} | {r.Label} | {r.Sample.Name}@{r.Sample.Time:0.##} | {r.Shot.Mode} | {actors} | {Pct(r.AttackerOccupancy)} | {Pct(r.VictimOccupancy)} | {Pct(r.CombinedHeight)} | {Pct(r.SilhouetteGap)} | {r.Reach:0.000} | {r.FrameWidthMeters:0.0}m | {(r.Passed ? "PASS" : "FAIL: " + string.Join(", ", r.Problems))}");
            }
        }

        private static void AppendSummaries(StringBuilder report, List<SampleResult> results)
        {
            var main = results.Where(r => Methods.Any(m => m.method == r.Label)).ToList();
            report.AppendLine();
            report.AppendLine("[CAM-METHOD-ENV] method | env | shot@attack_mid | attacker occ | victim occ | combinedH | gap | reach | frameW | failing samples (incl. role variants)");
            foreach (var (method, _) in Methods)
            {
                foreach (var env in ReconstructionFramingReport.Environments)
                {
                    var mid = main.First(r => r.Label == method && r.Environment == env && r.Sample.Name == "attack_mid");
                    var failing = results.Count(r => r.Environment == env && r.Label.StartsWith(method) && !r.Passed);
                    report.AppendLine($"[CAM-METHOD-ENV] {method} | {env} | {mid.Shot.Mode} | {Pct(mid.AttackerOccupancy)} | {Pct(mid.VictimOccupancy)} | {Pct(mid.CombinedHeight)} | {Pct(mid.SilhouetteGap)} | {mid.Reach:0.000} | {mid.FrameWidthMeters:0.0}m | {failing}");
                }
            }

            report.AppendLine();
            report.AppendLine("[CAM-SAMPLE-ENV] sample | env | shot | relevant standing occupancy min/median/max | combinedH median | frameW | failing");
            foreach (var name in main.Select(r => r.Sample.Name).Distinct())
            {
                foreach (var env in ReconstructionFramingReport.Environments)
                {
                    var rows = main.Where(r => r.Sample.Name == name && r.Environment == env).ToList();
                    var occ = rows.SelectMany(r => r.Actors.Where(a => a.Visible && a.Relevant && !a.Shot.lying).Select(a => a.Shot.occupancy)).ToList();
                    var modes = string.Join("/", rows.Select(r => r.Shot.Mode).Distinct());
                    report.AppendLine($"[CAM-SAMPLE-ENV] {name} | {env} | {modes} | {Stats(occ)} | {Pct(Median(rows.Select(r => r.CombinedHeight).ToList()))} | {rows[0].FrameWidthMeters:0.0}m | {rows.Count(r => !r.Passed)}/{rows.Count}");
                }
            }
        }

        /// <summary>Every cut in each real fixture over its whole duration, sampled finely: when, and from which shot to
        /// which — so rapid back-and-forth switching would be visible.</summary>
        private static void AppendCuts(StringBuilder report, ShotSelector selector)
        {
            report.AppendLine();
            foreach (var file in RealMethodFixtures)
            {
                var scenario = LoadFixture(file);
                var cuts = new List<string>();
                var previous = selector(scenario, 0f);
                for (var t = 0f; t <= scenario.durationSeconds; t += 0.25f)
                {
                    var shot = selector(scenario, t);
                    if (shot.Mode == previous.Mode && shot.Position == previous.Position) continue;
                    cuts.Add($"{t:0.##}s {previous.Mode}->{shot.Mode}");
                    previous = shot;
                }
                report.AppendLine($"[CAM-CUTS] {file} ({scenario.environment}): {cuts.Count} cuts: {string.Join(", ", cuts)}");
            }
        }

        private static string Ok(bool value) => value ? "ok" : "NO";

        private static string Pct(float value) => $"{value * 100f:0.0}%";

        private static float Median(List<float> values)
        {
            if (values.Count == 0) return 0f;
            var sorted = values.OrderBy(v => v).ToList();
            var mid = sorted.Count / 2;
            return sorted.Count % 2 == 0 ? (sorted[mid - 1] + sorted[mid]) / 2f : sorted[mid];
        }

        private static string Stats(List<float> values)
        {
            if (values.Count == 0) return "n/a";
            var sorted = values.OrderBy(v => v).ToList();
            return $"{Pct(sorted[0])}/{Pct(Median(sorted))}/{Pct(sorted[^1])}";
        }
    }
}
