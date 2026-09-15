using System.Collections.Generic;
using System.IO;
using System.Linq;
using Caseline.Reconstruction;
using UnityEditor;
using UnityEngine;

namespace Caseline.ReconstructionEditor
{
    /// <summary>
    /// Phase U5.2.1 — Editor menu tool reporting deterministic occupancy
    /// for Reconstruction's 2 fixed cameras across all 5 environment kinds
    /// x all 5 semantic slots, plus the real exported POC scenario's actual
    /// actor positions. Mirrors U4.3's `CCTVFramingReport` in spirit only —
    /// a fully separate file, never touching CCTV's own tool/camera data.
    /// </summary>
    public static class ReconstructionFramingReport
    {
        private struct CameraSpec
        {
            public Vector3 Position;
            public Vector3 LookTargetDirection;
            public float Fov;
        }

        // Must match ReconstructionSceneBuilder.BuildCameras() exactly —
        // duplicated here the same way CCTVFramingReport duplicates
        // CAMERA_PRESETS, so this report never depends on a live-built
        // scene existing.
        // Must match ReconstructionSceneBuilder.BuildCameras()'s U5.2.1
        // dolly-in fix exactly — see that method's own doc comment.
        private static readonly CameraSpec Overview = new()
        {
            Position = new Vector3(0f, 6.75f, -9.78f),
            LookTargetDirection = new Vector3(0f, -0.7f, 1f).normalized,
            Fov = 55f,
        };

        private static readonly CameraSpec Close = new()
        {
            Position = new Vector3(0f, 2.5f, -6.5f),
            LookTargetDirection = new Vector3(0f, -0.25f, 1f).normalized,
            Fov = 50f,
        };

        private static readonly string[] Environments = { "corridor", "parking", "shop", "street", "generic" };
        private static readonly string[] Slots = { "entrance", "interaction", "crime_point", "interior_center", "exit" };
        private static readonly HashSet<string> CloseActiveSlots = new() { "interaction", "crime_point" };

        [MenuItem("Tools/CASELINE/Report Reconstruction Framing Occupancy")]
        public static void Run()
        {
            var camGo = new GameObject("ReconstructionMeasurementCamera");
            var cam = camGo.AddComponent<Camera>();
            var report = new System.Text.StringBuilder();

            report.AppendLine("[RECON-FRAMING] environment | slot | camera | active | occupancy | clipped");

            var activeOccupancies = new List<float>();
            var overviewByEnv = new Dictionary<string, List<float>>();
            var closeByEnv = new Dictionary<string, List<float>>();
            foreach (var env in Environments)
            {
                overviewByEnv[env] = new List<float>();
                closeByEnv[env] = new List<float>();
            }

            foreach (var env in Environments)
            {
                foreach (var slot in Slots)
                {
                    var actorPos = ReconstructionZoneLayout.GetZonePosition(env, slot);
                    foreach (var (camName, spec) in new[] { ("overview", Overview), ("close", Close) })
                    {
                        ApplyCameraSpec(cam, spec);
                        var occupancy = ReconstructionFramingMeasurement.VerticalOccupancy(cam, actorPos);
                        var clipped = ReconstructionFramingMeasurement.IsClipped(cam, actorPos);
                        var isActive = (camName == "close") == CloseActiveSlots.Contains(slot);
                        report.AppendLine(
                            $"[RECON-FRAMING] {env} | {slot} | {camName} | active={isActive} | occupancy={occupancy * 100f:0.0}% | clipped={clipped}");
                        if (isActive)
                        {
                            activeOccupancies.Add(occupancy);
                            (camName == "close" ? closeByEnv[env] : overviewByEnv[env]).Add(occupancy);
                        }
                    }
                }
            }

            foreach (var env in Environments)
            {
                report.AppendLine(
                    $"[RECON-FRAMING-SUMMARY] {env} overview: min={SafeMin(overviewByEnv[env]) * 100f:0.0}% median={SafeMedian(overviewByEnv[env]) * 100f:0.0}% max={SafeMax(overviewByEnv[env]) * 100f:0.0}%");
                report.AppendLine(
                    $"[RECON-FRAMING-SUMMARY] {env} close: min={SafeMin(closeByEnv[env]) * 100f:0.0}% median={SafeMedian(closeByEnv[env]) * 100f:0.0}% max={SafeMax(closeByEnv[env]) * 100f:0.0}%");
            }

            // Real POC scenario — actual actor waypoint positions, measured
            // with whichever camera would genuinely be active at that
            // waypoint's own time (ReconstructionCameraController's own
            // deterministic selection), not a hypothetical slot table.
            var fixturePath = Path.Combine(Application.dataPath, "StreamingAssets", "reconstruction-poc-real.json");
            if (File.Exists(fixturePath))
            {
                var json = File.ReadAllText(fixturePath);
                if (ReconstructionJsonLoader.TryLoad(json, out var scenario, out var loadError))
                {
                    report.AppendLine("[RECON-FRAMING] --- real POC scenario (poc-fixture-u5-2) ---");
                    foreach (var actor in scenario.actors)
                    {
                        foreach (var wp in actor.waypoints)
                        {
                            var useClose = ReconstructionCameraController.ShouldUseCloseCamera(scenario, wp.time);
                            var spec = useClose ? Close : Overview;
                            ApplyCameraSpec(cam, spec);
                            var pos = ReconstructionZoneLayout.GetActorZonePosition(scenario.environment, wp.slot, actor.roleForReconstruction);
                            var occupancy = ReconstructionFramingMeasurement.VerticalOccupancy(cam, pos);
                            var clipped = ReconstructionFramingMeasurement.IsClipped(cam, pos);
                            report.AppendLine(
                                $"[RECON-FRAMING-REAL] actor={actor.roleForReconstruction} t={wp.time:0} slot={wp.slot} camera={(useClose ? "close" : "overview")} occupancy={occupancy * 100f:0.0}% clipped={clipped}");
                        }
                    }
                }
                else
                {
                    report.AppendLine($"[RECON-FRAMING] real POC scenario failed to load: {loadError}");
                }
            }
            else
            {
                report.AppendLine($"[RECON-FRAMING] real POC fixture not found at {fixturePath}");
            }

            report.AppendLine(
                $"[RECON-FRAMING-SUMMARY] all-active-combos: min={SafeMin(activeOccupancies) * 100f:0.0}% median={SafeMedian(activeOccupancies) * 100f:0.0}% max={SafeMax(activeOccupancies) * 100f:0.0}%");

            Debug.Log(report.ToString());
            Object.DestroyImmediate(camGo);
        }

        private static void ApplyCameraSpec(Camera cam, CameraSpec spec)
        {
            cam.transform.position = spec.Position;
            cam.transform.rotation = Quaternion.LookRotation(spec.LookTargetDirection, Vector3.up);
            cam.fieldOfView = spec.Fov;
            cam.nearClipPlane = 0.1f;
            cam.farClipPlane = 100f;
        }

        private static float SafeMin(List<float> values) => values.Count == 0 ? 0f : values.Min();
        private static float SafeMax(List<float> values) => values.Count == 0 ? 0f : values.Max();

        private static float SafeMedian(List<float> values)
        {
            if (values.Count == 0) return 0f;
            var sorted = values.OrderBy(v => v).ToList();
            var mid = sorted.Count / 2;
            return sorted.Count % 2 == 0 ? (sorted[mid - 1] + sorted[mid]) / 2f : sorted[mid];
        }
    }
}
