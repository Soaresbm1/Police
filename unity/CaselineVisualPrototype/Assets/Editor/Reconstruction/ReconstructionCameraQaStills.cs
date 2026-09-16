using System.Collections.Generic;
using System.IO;
using System.Linq;
using Caseline.Reconstruction;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Caseline.ReconstructionEditor
{
    /// <summary>
    /// Dev-only visual QA: renders the reconstruction scene, with real actors posed by the real timeline, at exact beat
    /// times through a camera placed where a selector (U5.4 or U5.5) puts it, and writes contact sheets. Rendering from
    /// the Editor makes every still land on the intended frame, which a throttled browser tab cannot guarantee. Needs a
    /// graphics device: run in batch mode WITHOUT -nographics. Output goes to the report directory, never the project.
    /// </summary>
    public static class ReconstructionCameraQaStills
    {
        private const int CellWidth = 480;
        private const int CellHeight = 300;
        private const int Columns = 4;

        /// <summary>The U5.5 matrix report and the stills in one Editor session.</summary>
        public static void ReportAndRender()
        {
            ReconstructionCameraMatrix.ReportActionCameras();
            Render();
        }

        [MenuItem("Tools/CASELINE/Render Reconstruction Camera QA Stills")]
        public static void Render()
        {
            EditorSceneManager.OpenScene("Assets/Scenes/ReconstructionPrototype.unity", OpenSceneMode.Single);
            var scene = Object.FindFirstObjectByType<ReconstructionSceneController>();
            foreach (var cam in Object.FindObjectsByType<Camera>(FindObjectsInactive.Include, FindObjectsSortMode.None)) cam.enabled = false;

            var qaCamera = new GameObject("QaStillCamera").AddComponent<Camera>();
            qaCamera.enabled = false;
            qaCamera.clearFlags = CameraClearFlags.Skybox;
            var target = new RenderTexture(CellWidth, CellHeight, 24);
            qaCamera.targetTexture = target;
            var outDir = Path.Combine(Path.GetDirectoryName(ReconstructionCameraMatrix.ReportPath("x"))!, "stills");
            Directory.CreateDirectory(outDir);

            try
            {
                foreach (var file in ReconstructionCameraMatrix.RealMethodFixtures)
                {
                    var scenario = ReconstructionCameraMatrix.LoadFixture(file);
                    var samples = ReconstructionCameraMatrix.SamplesFor(scenario);
                    var cells = new List<(ReconstructionCameraMatrix.ShotSelector selector, float time)>();
                    // Row 1: U5.4 at talk / attack start / attack mid / discovery. Rows 2–3: U5.5 at every beat.
                    foreach (var name in new[] { "talk", "attack_start", "attack_mid", "discovery" }) cells.Add((ReconstructionCameraMatrix.U54Selector, TimeOf(samples, name)));
                    foreach (var s in samples) cells.Add((ReconstructionCameraMatrix.DirectorSelector, s.Time));
                    WriteSheet(scene, qaCamera, target, scenario, cells, Path.Combine(outDir, Path.GetFileNameWithoutExtension(file) + ".png"));
                }

                foreach (var env in ReconstructionFramingReport.Environments)
                {
                    var strike = ReconstructionCameraMatrix.BuildScenario(env, "attack_strike", "accomplice", "unnamed");
                    var cells = new List<(ReconstructionCameraMatrix.ShotSelector, float)>();
                    foreach (var s in ReconstructionCameraMatrix.SamplesFor(strike)) cells.Add((ReconstructionCameraMatrix.U54Selector, s.Time));
                    foreach (var s in ReconstructionCameraMatrix.SamplesFor(strike)) cells.Add((ReconstructionCameraMatrix.DirectorSelector, s.Time));
                    WriteSheet(scene, qaCamera, target, strike, cells, Path.Combine(outDir, $"env-{env}-strike-with-bystander.png"));

                    var perAction = new List<(ReconstructionScenarioData scenario, float time)>();
                    foreach (var action in new[] { "attack_strike", "attack_stab", "attack_strangle", "attack_firearm", "attack_push", "attack_administer_substance" })
                    {
                        var s = ReconstructionCameraMatrix.BuildScenario(env, action);
                        perAction.Add((s, ReconstructionCameraMatrix.AttackTime + ReconstructionActorTimeline.AttackBeatSeconds * 0.6f));
                    }
                    WriteActionSheet(scene, qaCamera, target, perAction, Path.Combine(outDir, $"env-{env}-actions.png"));
                }
            }
            finally
            {
                scene.ClearScenario();
                qaCamera.targetTexture = null;
                Object.DestroyImmediate(target);
                Object.DestroyImmediate(qaCamera.gameObject);
            }
            Debug.Log($"[Reconstruction] camera QA stills written to {outDir}");
        }

        private static float TimeOf(List<ReconstructionCameraMatrix.Sample> samples, string name) => samples.First(s => s.Name == name).Time;

        private static void WriteSheet(ReconstructionSceneController scene, Camera camera, RenderTexture target, ReconstructionScenarioData scenario, List<(ReconstructionCameraMatrix.ShotSelector selector, float time)> cells, string path)
        {
            scene.ClearScenario();
            scene.ApplyScenario(scenario);
            var sheet = NewSheet(cells.Count);
            for (var i = 0; i < cells.Count; i++)
            {
                RenderCell(scene, camera, target, scenario, cells[i].selector, cells[i].time, sheet, i, cells.Count);
            }
            Save(sheet, path);
        }

        private static void WriteActionSheet(ReconstructionSceneController scene, Camera camera, RenderTexture target, List<(ReconstructionScenarioData scenario, float time)> cells, string path)
        {
            var sheet = NewSheet(cells.Count * 2);
            for (var i = 0; i < cells.Count; i++)
            {
                scene.ClearScenario();
                scene.ApplyScenario(cells[i].scenario);
                RenderCell(scene, camera, target, cells[i].scenario, ReconstructionCameraMatrix.U54Selector, cells[i].time, sheet, i, cells.Count * 2);
                RenderCell(scene, camera, target, cells[i].scenario, ReconstructionCameraMatrix.DirectorSelector, cells[i].time, sheet, cells.Count + i, cells.Count * 2);
            }
            Save(sheet, path);
        }

        private static Texture2D NewSheet(int cellCount)
        {
            var rows = Mathf.CeilToInt(cellCount / (float)Columns);
            return new Texture2D(CellWidth * Columns, CellHeight * rows, TextureFormat.RGB24, false);
        }

        private static void RenderCell(ReconstructionSceneController scene, Camera camera, RenderTexture target, ReconstructionScenarioData scenario, ReconstructionCameraMatrix.ShotSelector selector, float time, Texture2D sheet, int index, int cellCount)
        {
            scene.Evaluate(time);
            foreach (var actor in scene.SpawnedActors)
            {
                if (actor == null || !actor.gameObject.activeSelf) continue;
                var animator = actor.GetComponent<Animator>();
                if (animator != null) animator.Update(0f);
            }

            var shot = selector(scenario, time);
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

            var rows = Mathf.CeilToInt(cellCount / (float)Columns);
            var column = index % Columns;
            var row = rows - 1 - index / Columns; // texture origin is bottom-left; first cell goes top-left
            sheet.SetPixels(column * CellWidth, row * CellHeight, CellWidth, CellHeight, cell.GetPixels());
            // A thin frame per cell so adjacent stills don't read as one image.
            for (var x = 0; x < CellWidth; x++)
            {
                sheet.SetPixel(column * CellWidth + x, row * CellHeight, Color.black);
                sheet.SetPixel(column * CellWidth + x, row * CellHeight + CellHeight - 1, Color.black);
            }
            for (var y = 0; y < CellHeight; y++)
            {
                sheet.SetPixel(column * CellWidth, row * CellHeight + y, Color.black);
                sheet.SetPixel(column * CellWidth + CellWidth - 1, row * CellHeight + y, Color.black);
            }
            Object.DestroyImmediate(cell);
        }

        private static void Save(Texture2D sheet, string path)
        {
            sheet.Apply();
            File.WriteAllBytes(path, sheet.EncodeToPNG());
            Object.DestroyImmediate(sheet);
        }
    }
}
