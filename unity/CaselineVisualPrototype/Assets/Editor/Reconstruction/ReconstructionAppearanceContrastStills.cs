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
    /// U5.7 dev-only visual QA: every environment rendered with each of the three genericAppearance tones (dark, neutral,
    /// light) at the attack and at the discovery, through the real fixed director cameras. The other QA stills use the
    /// neutral tone only, so they cannot show whether a dark or a light mannequin disappears into an environment surface.
    /// Needs a graphics device (batch mode WITHOUT -nographics). Output goes to CASELINE_REPORT_DIR (or Temp), never to the
    /// project, and is never committed.
    /// </summary>
    public static class ReconstructionAppearanceContrastStills
    {
        private const int CellWidth = 480;
        private const int CellHeight = 300;
        private static readonly string[] Appearances = { "a_dark", "a", "a_light" };

        [MenuItem("Tools/CASELINE/Render Reconstruction Appearance Contrast Stills")]
        public static void Render()
        {
            EditorSceneManager.OpenScene("Assets/Scenes/ReconstructionPrototype.unity", OpenSceneMode.Single);
            var scene = Object.FindFirstObjectByType<ReconstructionSceneController>();
            foreach (var cam in Object.FindObjectsByType<Camera>(FindObjectsInactive.Include, FindObjectsSortMode.None)) cam.enabled = false;

            var qaCamera = new GameObject("QaAppearanceCamera").AddComponent<Camera>();
            qaCamera.enabled = false;
            qaCamera.clearFlags = CameraClearFlags.Skybox;
            var target = new RenderTexture(CellWidth, CellHeight, 24);
            qaCamera.targetTexture = target;
            var outDir = Path.Combine(Path.GetDirectoryName(ReconstructionCameraMatrix.ReportPath("x"))!, "appearance");
            Directory.CreateDirectory(outDir);

            try
            {
                foreach (var env in ReconstructionFramingReport.Environments)
                {
                    var cells = new List<Texture2D>();
                    foreach (var appearance in Appearances)
                    {
                        var scenario = ReconstructionCameraMatrix.BuildScenario(env, "attack_strike");
                        foreach (var actor in scenario.actors) actor.genericAppearance = appearance;
                        scene.ClearScenario();
                        scene.ApplyScenario(scenario);
                        var samples = ReconstructionCameraMatrix.SamplesFor(scenario);
                        var attack = ReconstructionCameraMatrix.AttackTime + ReconstructionActorTimeline.AttackBeatSeconds * 0.6f;
                        var discovery = samples.First(s => s.Name == "discovery").Time;
                        cells.Add(RenderCell(scene, qaCamera, target, scenario, attack));
                        cells.Add(RenderCell(scene, qaCamera, target, scenario, discovery));
                    }
                    // Two columns (attack, discovery) x three rows (dark, neutral, light).
                    var sheet = new Texture2D(CellWidth * 2, CellHeight * 3, TextureFormat.RGB24, false);
                    for (var i = 0; i < cells.Count; i++)
                    {
                        var column = i % 2;
                        var row = 2 - i / 2;
                        sheet.SetPixels(column * CellWidth, row * CellHeight, CellWidth, CellHeight, cells[i].GetPixels());
                        Object.DestroyImmediate(cells[i]);
                    }
                    sheet.Apply();
                    File.WriteAllBytes(Path.Combine(outDir, $"appearance-{env}.png"), sheet.EncodeToPNG());
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
            Debug.Log($"[Reconstruction] appearance contrast stills written to {outDir}");
        }

        private static Texture2D RenderCell(ReconstructionSceneController scene, Camera camera, RenderTexture target, ReconstructionScenarioData scenario, float time)
        {
            scene.Evaluate(time);
            foreach (var actor in scene.SpawnedActors)
            {
                if (actor == null || !actor.gameObject.activeSelf) continue;
                var animator = actor.GetComponent<Animator>();
                if (animator != null) animator.Update(0f);
            }

            var shot = ReconstructionCameraMatrix.DirectorSelector(scenario, time);
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
