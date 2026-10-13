using System.IO;
using System.Linq;
using Caseline.Reconstruction;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Caseline.ReconstructionEditor
{
    /// <summary>
    /// Dev-only visual QA for the reconstruction's final beat (the discovery): every environment rendered large, through
    /// the real director camera, so lighting/atmosphere work can be compared before and after. The label (default
    /// "current") comes from CASELINE_STILLS_LABEL. Needs a graphics device (batch mode WITHOUT -nographics). Output goes
    /// to CASELINE_REPORT_DIR (or Temp), never to the project, and is never committed.
    /// </summary>
    public static class ReconstructionEndSceneQaStills
    {
        private const int Width = 960;
        private const int Height = 600;

        [MenuItem("Tools/CASELINE/Render Reconstruction End Scene Stills")]
        public static void Render()
        {
            EditorSceneManager.OpenScene("Assets/Scenes/ReconstructionPrototype.unity", OpenSceneMode.Single);
            var scene = Object.FindFirstObjectByType<ReconstructionSceneController>();
            foreach (var cam in Object.FindObjectsByType<Camera>(FindObjectsInactive.Include, FindObjectsSortMode.None)) cam.enabled = false;

            var label = System.Environment.GetEnvironmentVariable("CASELINE_STILLS_LABEL");
            if (string.IsNullOrEmpty(label)) label = "current";
            var outDir = Path.Combine(Path.GetDirectoryName(ReconstructionCameraMatrix.ReportPath("x"))!, "end-scene", label);
            Directory.CreateDirectory(outDir);

            var qaCamera = new GameObject("QaEndSceneCamera").AddComponent<Camera>();
            qaCamera.enabled = false;
            qaCamera.clearFlags = CameraClearFlags.Skybox;
            var target = new RenderTexture(Width, Height, 24);
            qaCamera.targetTexture = target;

            try
            {
                foreach (var env in ReconstructionFramingReport.Environments)
                {
                    var scenario = ReconstructionCameraMatrix.BuildScenario(env, "attack_strike");
                    scene.ClearScenario();
                    scene.ApplyScenario(scenario);
                    var discovery = ReconstructionCameraMatrix.SamplesFor(scenario).First(s => s.Name == "discovery").Time;
                    scene.Evaluate(discovery);
                    foreach (var actor in scene.SpawnedActors)
                    {
                        if (actor == null || !actor.gameObject.activeSelf) continue;
                        var animator = actor.GetComponent<Animator>();
                        if (animator != null) animator.Update(0f);
                    }

                    var shot = ReconstructionCameraMatrix.DirectorSelector(scenario, discovery);
                    // This QA camera is not the scene's own, so give it the sky the mood gives the real ones.
                    var mood = scene.CurrentMood;
                    qaCamera.clearFlags = mood.SolidSky ? CameraClearFlags.SolidColor : CameraClearFlags.Skybox;
                    qaCamera.backgroundColor = mood.Sky;
                    qaCamera.transform.SetPositionAndRotation(shot.Position, shot.Rotation);
                    qaCamera.fieldOfView = shot.FieldOfView;
                    qaCamera.aspect = (float)Width / Height;
                    qaCamera.nearClipPlane = 0.1f;
                    qaCamera.farClipPlane = 100f;
                    qaCamera.Render();

                    var previous = RenderTexture.active;
                    RenderTexture.active = target;
                    var tex = new Texture2D(Width, Height, TextureFormat.RGB24, false);
                    tex.ReadPixels(new Rect(0, 0, Width, Height), 0, 0);
                    RenderTexture.active = previous;
                    ApplyVignette(tex, scene.CurrentMood.Vignette);
                    tex.Apply();
                    File.WriteAllBytes(Path.Combine(outDir, $"endscene-{env}.png"), tex.EncodeToPNG());
                    Object.DestroyImmediate(tex);
                }
            }
            finally
            {
                scene.ClearScenario();
                qaCamera.targetTexture = null;
                Object.DestroyImmediate(target);
                Object.DestroyImmediate(qaCamera.gameObject);
            }
            Debug.Log($"[Reconstruction] end scene stills ({label}) written to {outDir}");
        }

        /// <summary>The overlay draws the vignette over the canvas at runtime (IMGUI), which a camera render never sees;
        /// applying the same shape here keeps the stills faithful to what the player gets.</summary>
        private static void ApplyVignette(Texture2D tex, float strength)
        {
            if (strength <= 0.001f) return;
            var pixels = tex.GetPixels();
            for (var y = 0; y < Height; y++)
            {
                for (var x = 0; x < Width; x++)
                {
                    var nx = (x + 0.5f) / Width * 2f - 1f;
                    var ny = (y + 0.5f) / Height * 2f - 1f;
                    var keep = 1f - ReconstructionAtmosphere.VignetteAlpha(nx, ny) * Mathf.Clamp01(strength);
                    var p = pixels[y * Width + x];
                    pixels[y * Width + x] = new Color(p.r * keep, p.g * keep, p.b * keep, 1f);
                }
            }
            tex.SetPixels(pixels);
        }
    }
}
