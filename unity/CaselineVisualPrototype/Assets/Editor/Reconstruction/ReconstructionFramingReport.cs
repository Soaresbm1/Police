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
    /// Editor menu tool reporting deterministic occupancy, frame clipping and scenery occlusion for Reconstruction's
    /// two fixed cameras across all five environments, plus the real POC scenario's actual evaluated poses.
    /// Fully separate from CCTV's framing tooling.
    /// </summary>
    public static class ReconstructionFramingReport
    {
        public static readonly string[] Environments = { "corridor", "parking", "shop", "street", "generic" };
        private static readonly string[] Slots = { "entrance", "interaction", "crime_point", "interior_center", "exit" };

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

        /// <summary>The camera active for the slot, plus the overview for the victim's body at crime_point, which stays
        /// in the overview shot through leave_scene and stage_scene.</summary>
        public static IEnumerable<Camera> CamerasThatMustSee(string slot, string role, Camera overview, Camera close)
        {
            yield return ReconstructionCameraController.IsCloseSlot(slot) ? close : overview;
            if (slot == "crime_point" && role == "victim") yield return overview;
        }

        [MenuItem("Tools/CASELINE/Report Reconstruction Framing Occupancy")]
        public static void Run()
        {
            var overview = new GameObject("ReconstructionMeasurementOverview").AddComponent<Camera>();
            ReconstructionCameraController.ApplyOverviewSpec(overview);
            var close = new GameObject("ReconstructionMeasurementClose").AddComponent<Camera>();
            ReconstructionCameraController.ApplyCloseSpec(close);

            var report = new StringBuilder();
            try
            {
                ReportSlotTable(report, overview, close);
                ReportReachableRoles(report, overview, close);
                ReportRealPoc(report, overview, close);
            }
            finally
            {
                Object.DestroyImmediate(overview.gameObject);
                Object.DestroyImmediate(close.gameObject);
            }
            Debug.Log(report.ToString());
        }

        private static void ReportSlotTable(StringBuilder report, Camera overview, Camera close)
        {
            report.AppendLine("[RECON-FRAMING] environment | slot | camera | active | occupancy | clipped");
            var all = new List<float>();
            foreach (var env in Environments)
            {
                var overviewValues = new List<float>();
                var closeValues = new List<float>();
                foreach (var slot in Slots)
                {
                    var pos = ReconstructionZoneLayout.GetZonePosition(env, slot);
                    foreach (var cam in new[] { overview, close })
                    {
                        var isClose = cam == close;
                        var occupancy = ReconstructionFramingMeasurement.VerticalOccupancy(cam, pos);
                        var clipped = ReconstructionFramingMeasurement.IsClipped(cam, pos);
                        var active = isClose == ReconstructionCameraController.IsCloseSlot(slot);
                        report.AppendLine($"[RECON-FRAMING] {env} | {slot} | {Name(isClose)} | active={active} | occupancy={Percent(occupancy)} | clipped={clipped}");
                        if (!active) continue;
                        (isClose ? closeValues : overviewValues).Add(occupancy);
                        all.Add(occupancy);
                    }
                }
                report.AppendLine($"[RECON-FRAMING-SUMMARY] {env} overview: {Stats(overviewValues)}");
                report.AppendLine($"[RECON-FRAMING-SUMMARY] {env} close: {Stats(closeValues)}");
            }
            report.AppendLine($"[RECON-FRAMING-SUMMARY] all-active-slot-combos: {Stats(all)}");
        }

        private static void ReportReachableRoles(StringBuilder report, Camera overview, Camera close)
        {
            report.AppendLine("[RECON-ROLES] environment | slot | role | camera | occupancy | clipped | occludedSamples");
            var problems = 0;
            foreach (var env in Environments)
            {
                var occluders = ReconstructionEnvironmentController.OccluderBounds(env);
                var overviewValues = new List<float>();
                var closeValues = new List<float>();
                foreach (var (slot, roles) in ReachableRolesBySlot)
                {
                    foreach (var role in roles)
                    {
                        var pos = ReconstructionZoneLayout.GetActorZonePosition(env, slot, role);
                        foreach (var cam in CamerasThatMustSee(slot, role, overview, close))
                        {
                            var isClose = cam == close;
                            var occupancy = ReconstructionFramingMeasurement.VerticalOccupancy(cam, pos);
                            var clipped = ReconstructionFramingMeasurement.IsClipped(cam, pos);
                            var occluded = ReconstructionFramingMeasurement.OccludedSampleCount(cam.transform.position, pos, occluders);
                            if (clipped || occluded > 0) problems++;
                            report.AppendLine($"[RECON-ROLES] {env} | {slot} | {role} | {Name(isClose)} | occupancy={Percent(occupancy)} | clipped={clipped} | occludedSamples={occluded}/3");
                            if (isClose == ReconstructionCameraController.IsCloseSlot(slot)) (isClose ? closeValues : overviewValues).Add(occupancy);
                        }
                    }
                }
                report.AppendLine($"[RECON-ROLES-SUMMARY] {env} overview: {Stats(overviewValues)}");
                report.AppendLine($"[RECON-ROLES-SUMMARY] {env} close: {Stats(closeValues)}");
            }
            report.AppendLine($"[RECON-ROLES-SUMMARY] clipped-or-occluded reachable combos: {problems}");
        }

        private static void ReportRealPoc(StringBuilder report, Camera overview, Camera close)
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
                var isClose = ReconstructionCameraController.ShouldUseCloseCamera(scenario, t);
                var cam = isClose ? close : overview;
                foreach (var actor in scenario.actors)
                {
                    var pose = ReconstructionActorTimeline.Evaluate(actor, scenario.events, scenario.environment, t);
                    if (!pose.visible) continue;
                    var lying = pose.animState == "Collapse";
                    var occupancy = lying ? "n/a (lying)" : Percent(ReconstructionFramingMeasurement.VerticalOccupancy(cam, pose.position));
                    var clipped = ReconstructionFramingMeasurement.IsClipped(cam, pose.position);
                    var heights = lying ? ReconstructionFramingMeasurement.LyingSampleHeights : ReconstructionFramingMeasurement.StandingSampleHeights;
                    var occluded = ReconstructionFramingMeasurement.OccludedSampleCount(cam.transform.position, pose.position, occluders, heights);
                    report.AppendLine(
                        $"[RECON-FRAMING-REAL] t={t:0.##} camera={Name(isClose)} actor={actor.roleForReconstruction} pose={pose.animState} occupancy={occupancy} clipped={clipped} occludedSamples={occluded}/{heights.Length}");
                }
            }
        }

        private static string Name(bool isClose) => isClose ? "close" : "overview";

        private static string Percent(float value) => $"{value * 100f:0.0}%";

        private static string Stats(List<float> values)
        {
            if (values.Count == 0) return "n/a";
            var sorted = values.OrderBy(v => v).ToList();
            var mid = sorted.Count / 2;
            var median = sorted.Count % 2 == 0 ? (sorted[mid - 1] + sorted[mid]) / 2f : sorted[mid];
            return $"min={Percent(sorted[0])} median={Percent(median)} max={Percent(sorted[^1])}";
        }
    }
}
