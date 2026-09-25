using System.Collections.Generic;
using System.IO;
using Caseline.Reconstruction;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Caseline.ReconstructionEditor
{
    /// <summary>
    /// Dev-only visual QA for the post-U5.7 staging-bounds fix. Renders the exact constrained combination at
    /// street/entrance and street/exit -- each of the four roles alone, then all four together (the stress case) --
    /// through the real Overview camera (the only shot that ever sees these two slots). Needs a graphics device
    /// (batch mode WITHOUT -nographics). Output goes to CASELINE_REPORT_DIR (or Temp), never the project, never
    /// player-accessible.
    /// </summary>
    public static class ReconstructionStagingBoundsQaStills
    {
        private const int CellWidth = 480;
        private const int CellHeight = 300;
        private static readonly string[] Roles = { "culprit", "victim", "accomplice", "unnamed" };

        [MenuItem("Tools/CASELINE/Render Reconstruction Staging Bounds QA Stills")]
        public static void Render()
        {
            EditorSceneManager.OpenScene("Assets/Scenes/ReconstructionPrototype.unity", OpenSceneMode.Single);
            var scene = Object.FindFirstObjectByType<ReconstructionSceneController>();
            foreach (var cam in Object.FindObjectsByType<Camera>(FindObjectsInactive.Include, FindObjectsSortMode.None)) cam.enabled = false;

            var qaCamera = new GameObject("QaStagingBoundsCamera").AddComponent<Camera>();
            qaCamera.enabled = false;
            qaCamera.clearFlags = CameraClearFlags.Skybox;
            var target = new RenderTexture(CellWidth, CellHeight, 24);
            qaCamera.targetTexture = target;
            var outDir = Path.Combine(Path.GetDirectoryName(ReconstructionCameraMatrix.ReportPath("x"))!, "staging-bounds");
            Directory.CreateDirectory(outDir);

            try
            {
                foreach (var slot in new[] { "entrance", "exit" })
                {
                    var cells = new List<Texture2D>();
                    foreach (var role in Roles) cells.Add(RenderSingleRole(scene, qaCamera, target, slot, role));
                    cells.Add(RenderAllFour(scene, qaCamera, target, slot));
                    var sheet = new Texture2D(CellWidth * 3, CellHeight * 2, TextureFormat.RGB24, false);
                    for (var i = 0; i < cells.Count; i++)
                    {
                        var column = i % 3;
                        var row = 1 - i / 3;
                        sheet.SetPixels(column * CellWidth, row * CellHeight, CellWidth, CellHeight, cells[i].GetPixels());
                        Object.DestroyImmediate(cells[i]);
                    }
                    sheet.Apply();
                    File.WriteAllBytes(Path.Combine(outDir, $"street-{slot}.png"), sheet.EncodeToPNG());
                    Object.DestroyImmediate(sheet);
                }
            }
            finally
            {
                scene.ClearScenario();
                qaCamera.targetTexture = null;
                Object.DestroyImmediate(target);
                Object.DestroyImmediate(qaCamera.gameObject);
            }
            Debug.Log($"[Reconstruction] staging bounds QA stills written to {outDir}");
        }

        private static ReconstructionActorData Idler(string id, string role, string slot) => new()
        {
            visualId = id,
            roleForReconstruction = role,
            genericAppearance = "casual_neutral",
            spawnTime = 0f,
            despawnTime = 100f,
            waypoints = new List<ReconstructionWaypointData> { new() { time = 0f, slot = slot } },
        };

        private static Texture2D RenderSingleRole(ReconstructionSceneController scene, Camera camera, RenderTexture target, string slot, string role)
        {
            var scenario = new ReconstructionScenarioData { version = ReconstructionSchema.SupportedVersion, caseId = $"staging-bounds-{slot}-{role}", environment = "street", durationSeconds = 10f };
            scenario.actors.Add(Idler("a", role, slot));
            return RenderCell(scene, camera, target, scenario);
        }

        private static Texture2D RenderAllFour(ReconstructionSceneController scene, Camera camera, RenderTexture target, string slot)
        {
            var scenario = new ReconstructionScenarioData { version = ReconstructionSchema.SupportedVersion, caseId = $"staging-bounds-{slot}-stress", environment = "street", durationSeconds = 10f };
            for (var i = 0; i < Roles.Length; i++) scenario.actors.Add(Idler($"a{i}", Roles[i], slot));
            return RenderCell(scene, camera, target, scenario);
        }

        private static Texture2D RenderCell(ReconstructionSceneController scene, Camera camera, RenderTexture target, ReconstructionScenarioData scenario)
        {
            scene.ClearScenario();
            scene.ApplyScenario(scenario);
            scene.Evaluate(1f);
            foreach (var actor in scene.SpawnedActors)
            {
                if (actor == null || !actor.gameObject.activeSelf) continue;
                var animator = actor.GetComponent<Animator>();
                if (animator != null) animator.Update(0f);
            }

            var shot = ReconstructionCameraPresets.Overview();
            camera.transform.SetPositionAndRotation(shot.Position, shot.Rotation);
            camera.fieldOfView = shot.FieldOfView;
            camera.aspect = ReconstructionFramingMeasurement.ViewerAspect;
            camera.nearClipPlane = 0.1f;
            camera.farClipPlane = 100f;
            camera.Render();

            var previous = RenderTexture.active;
            RenderTexture.active = target;
            var cell = new Texture2D(CellWidth, CellHeight, TextureFormat.RGB24, false);
            cell.ReadPixels(new Rect(0, 0, CellWidth, CellHeight), 0, 0);
            cell.Apply();
            RenderTexture.active = previous;
            return cell;
        }
    }
}
