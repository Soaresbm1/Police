using System.Collections.Generic;
using System.Linq;
using Caseline.CCTV;
using UnityEditor;
using UnityEngine;

namespace Caseline.CCTVEditor
{
    /// <summary>
    /// Phase U4.3 — deterministic visual/occupancy QA across all 5
    /// environment kinds, using the exact camera preset values
    /// <c>unity-cctv-bridge.ts</c> sends (mirrored here — see
    /// <see cref="CameraPresets"/>) and <see cref="CCTVCameraFraming"/>'s
    /// real FOV lookup. Never touches CASELINE gameplay, Supabase, or
    /// CaseTruth — this only ever builds throwaway Editor GameObjects
    /// from already-public, non-secret constants (environment kind, the
    /// same synthetic path conventions <c>unity-cctv-bridge.ts</c> itself
    /// uses) and destroys them immediately after measuring.
    /// </summary>
    public static class CCTVFramingReport
    {
        private struct Preset
        {
            public Vector3 Position;
            public Vector3 Rotation;
        }

        /// <summary>Mirrors CAMERA_PRESETS in lib/art/unity-cctv-bridge.ts
        /// exactly — kept in sync by hand since the source of truth is
        /// TypeScript; any preset retune must update both.</summary>
        private static readonly Dictionary<string, Preset> CameraPresets = new()
        {
            ["corridor"] = new Preset { Position = new Vector3(0f, 3.6f, -5.4f), Rotation = new Vector3(17.819f, 0f, 0f) },
            ["parking"] = new Preset { Position = new Vector3(-5.564f, 4.93f, -2.564f), Rotation = new Vector3(27.12f, 45f, 0f) },
            ["shop"] = new Preset { Position = new Vector3(-6.721f, 4.67f, -3.721f), Rotation = new Vector3(21.635f, 45f, 0f) },
            ["street"] = new Preset { Position = new Vector3(0f, 3.802f, -3.496f), Rotation = new Vector3(24.068f, 0f, 0f) },
            ["generic"] = new Preset { Position = new Vector3(-6.357f, 4.8f, -3.357f), Rotation = new Vector3(23.452f, 45f, 0f) },
        };

        /// <summary>Mirrors WORLD_HALF_WIDTH / LANE_DEPTH[1] in
        /// unity-cctv-bridge.ts — the standard mid-lane walking line every
        /// real scenario's actor path is mapped onto.</summary>
        private const float WorldHalfWidth = 9f;
        private const float MidLaneZ = 3f;

        [MenuItem("Tools/CASELINE/Report CCTV Framing Occupancy")]
        public static void Run()
        {
            var camGo = new GameObject("MeasurementCamera");
            var cam = camGo.AddComponent<Camera>();
            var report = new System.Text.StringBuilder();
            report.AppendLine("[CCTV-FRAMING] environment | t | x | occupancy | clipped");

            foreach (var kind in new[] { "corridor", "parking", "shop", "street", "generic" })
            {
                var preset = CameraPresets[kind];
                cam.transform.position = preset.Position;
                cam.transform.rotation = Quaternion.Euler(preset.Rotation);
                cam.fieldOfView = CCTVCameraFraming.FieldOfViewForKind(kind);
                cam.nearClipPlane = 0.1f;
                cam.farClipPlane = 100f;

                var occupancies = new List<float>();
                foreach (var t in new[] { 0f, 0.25f, 0.5f, 0.75f, 1f })
                {
                    var x = Mathf.Lerp(-WorldHalfWidth, WorldHalfWidth, t);
                    var actorRoot = new Vector3(x, 0f, MidLaneZ);
                    var occupancy = CCTVFramingMeasurement.VerticalOccupancy(cam, actorRoot);
                    var clipped = CCTVFramingMeasurement.IsClipped(cam, actorRoot);
                    occupancies.Add(occupancy);
                    report.AppendLine($"[CCTV-FRAMING] {kind} | t={t:0.00} | x={x:0.0} | occupancy={occupancy * 100f:0.0}% | clipped={clipped}");
                }

                report.AppendLine($"[CCTV-FRAMING-SUMMARY] {kind}: min={occupancies.Min() * 100f:0.0}% median={Median(occupancies) * 100f:0.0}% max={occupancies.Max() * 100f:0.0}%");
            }

            Debug.Log(report.ToString());
            Object.DestroyImmediate(camGo);
        }

        private static float Median(List<float> values)
        {
            var sorted = values.OrderBy(v => v).ToList();
            var mid = sorted.Count / 2;
            return sorted.Count % 2 == 0 ? (sorted[mid - 1] + sorted[mid]) / 2f : sorted[mid];
        }
    }
}
