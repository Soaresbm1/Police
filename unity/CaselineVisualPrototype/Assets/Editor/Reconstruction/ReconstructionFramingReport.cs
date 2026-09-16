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
    /// Editor menu tool reporting deterministic occupancy, frame clipping and scenery occlusion for every reachable
    /// actor placement under every reconstruction shot that can show it, plus the real POC scenario's actual
    /// evaluated poses. Fully separate from CCTV's framing tooling. The full method × environment matrix lives in
    /// <see cref="ReconstructionCameraMatrix"/>.
    /// </summary>
    public static class ReconstructionFramingReport
    {
        public static readonly string[] Environments = { "corridor", "parking", "shop", "street", "generic" };

        /// <summary>Roles the projector can actually place at each slot: talk and attack stage culprit and victim, the
        /// discoverer (unnamed, or an accomplice) comes to crime_point, stage_scene and leave_scene are the culprit's.
        /// V1 never emits an entrance event.</summary>
        public static readonly IReadOnlyDictionary<string, string[]> ReachableRolesBySlot = new Dictionary<string, string[]>
        {
            ["interaction"] = new[] { "culprit", "victim" },
            ["crime_point"] = new[] { "culprit", "victim", "unnamed", "accomplice" },
            ["interior_center"] = new[] { "culprit" },
            ["exit"] = new[] { "culprit" },
        };

        /// <summary>Every shot that can be on screen while someone stands at `slot` in `environment`: the shots the
        /// events staged at that slot select (a crime point hosts a physical attack, a neutral interaction and the
        /// discovery), plus the overview for the victim's body, which stays in it through the departure.</summary>
        public static IEnumerable<ReconstructionCameraShot> ShotsThatMustSee(string environment, string slot, string role)
        {
            switch (slot)
            {
                case "interaction":
                    yield return ReconstructionCameraPresets.Shot(environment, ReconstructionCameraMode.Interaction, slot);
                    break;
                case "crime_point":
                    yield return ReconstructionCameraPresets.Shot(environment, ReconstructionCameraMode.PhysicalAttack, slot);
                    yield return ReconstructionCameraPresets.Shot(environment, ReconstructionCameraMode.Interaction, slot);
                    yield return ReconstructionCameraPresets.Shot(environment, ReconstructionCameraMode.Discovery, slot);
                    if (role == "victim") yield return ReconstructionCameraPresets.Overview();
                    break;
                case "interior_center":
                    yield return ReconstructionCameraPresets.Shot(environment, ReconstructionCameraMode.Interaction, slot);
                    break;
                default:
                    yield return ReconstructionCameraPresets.Overview();
                    break;
            }
        }

        public static Camera MakeMeasurementCamera(string name)
        {
            var camera = new GameObject(name).AddComponent<Camera>();
            camera.enabled = false;
            camera.aspect = ReconstructionFramingMeasurement.ViewerAspect;
            return camera;
        }

        public static void Place(Camera camera, ReconstructionCameraShot shot)
        {
            ReconstructionCameraController.ApplyShot(camera, shot);
            camera.aspect = ReconstructionFramingMeasurement.ViewerAspect;
        }

        [MenuItem("Tools/CASELINE/Report Reconstruction Framing Occupancy")]
        public static void Run()
        {
            var camera = MakeMeasurementCamera("ReconstructionMeasurementCamera");
            var report = new StringBuilder();
            try
            {
                ReportReachableRoles(report, camera);
                ReportRealPoc(report, camera);
            }
            finally
            {
                Object.DestroyImmediate(camera.gameObject);
            }
            Debug.Log(report.ToString());
        }

        private static void ReportReachableRoles(StringBuilder report, Camera camera)
        {
            report.AppendLine("[RECON-ROLES] environment | slot | role | shot | occupancy | clipped | occludedSamples");
            var problems = 0;
            foreach (var env in Environments)
            {
                var occluders = ReconstructionEnvironmentController.OccluderBounds(env);
                foreach (var (slot, roles) in ReachableRolesBySlot)
                {
                    foreach (var role in roles)
                    {
                        var pos = ReconstructionZoneLayout.GetActorZonePosition(env, slot, role);
                        foreach (var shot in ShotsThatMustSee(env, slot, role))
                        {
                            Place(camera, shot);
                            var occupancy = ReconstructionFramingMeasurement.VerticalOccupancy(camera, pos);
                            var clipped = ReconstructionFramingMeasurement.IsClipped(camera, pos);
                            var occluded = ReconstructionFramingMeasurement.OccludedSampleCount(camera.transform.position, pos, occluders);
                            if (clipped || occluded > 0) problems++;
                            report.AppendLine($"[RECON-ROLES] {env} | {slot} | {role} | {shot.Mode} | occupancy={Percent(occupancy)} | clipped={clipped} | occludedSamples={occluded}/3");
                        }
                    }
                }
            }
            report.AppendLine($"[RECON-ROLES-SUMMARY] clipped-or-occluded reachable combos: {problems}");
        }

        private static void ReportRealPoc(StringBuilder report, Camera camera)
        {
            var path = Path.Combine(Application.dataPath, "StreamingAssets", "reconstruction-poc-real.json");
            if (!File.Exists(path))
            {
                report.AppendLine($"[RECON-FRAMING-REAL] fixture not found at {path}");
                return;
            }
            if (!ReconstructionJsonLoader.TryLoad(File.ReadAllText(path), out var scenario, out var error))
            {
                report.AppendLine($"[RECON-FRAMING-REAL] fixture failed to load: {error}");
                return;
            }

            var sampleTimes = new SortedSet<float>();
            foreach (var e in scenario.events)
            {
                sampleTimes.Add(e.time);
                if (e.type != "attack") continue;
                sampleTimes.Add(e.time + ReconstructionActorTimeline.AttackBeatSeconds * 0.125f);
                sampleTimes.Add(e.time + ReconstructionActorTimeline.AttackBeatSeconds + ReconstructionActorTimeline.CollapseTransitionSeconds + 1f);
            }

            var occluders = ReconstructionEnvironmentController.OccluderBounds(scenario.environment);
            report.AppendLine($"[RECON-FRAMING-REAL] --- {scenario.caseId} ({scenario.environment}) ---");
            foreach (var t in sampleTimes)
            {
                var shot = ReconstructionCameraDirector.SelectShot(scenario, t);
                Place(camera, shot);
                foreach (var actor in scenario.actors)
                {
                    var pose = ReconstructionActorTimeline.Evaluate(actor, scenario.events, scenario.environment, t);
                    if (!pose.visible) continue;
                    var lying = pose.animState == "Collapse";
                    var occupancy = lying ? "n/a (lying)" : Percent(ReconstructionFramingMeasurement.VerticalOccupancy(camera, pose.position));
                    var clipped = ReconstructionFramingMeasurement.IsClipped(camera, pose.position);
                    var heights = lying ? ReconstructionFramingMeasurement.LyingSampleHeights : ReconstructionFramingMeasurement.StandingSampleHeights;
                    var occluded = ReconstructionFramingMeasurement.OccludedSampleCount(camera.transform.position, pose.position, occluders, heights);
                    report.AppendLine(
                        $"[RECON-FRAMING-REAL] t={t:0.##} shot={shot.Mode} actor={actor.roleForReconstruction} pose={pose.animState} occupancy={occupancy} clipped={clipped} occludedSamples={occluded}/{heights.Length}");
                }
            }
        }

        private static string Percent(float value) => $"{value * 100f:0.0}%";
    }
}
