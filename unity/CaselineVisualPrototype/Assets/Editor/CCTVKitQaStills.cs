using System;
using System.Collections.Generic;
using System.IO;
using Caseline.CCTV;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using Object = UnityEngine.Object;

namespace Caseline.CCTVEditor
{
    /// <summary>
    /// Dev-only visual QA for the optional office kit in the surveillance view: one actor walking along the middle lane
    /// of each environment, rendered through the real fixed camera preset at a few instants. Needs a graphics device
    /// (batch mode WITHOUT -nographics). Output goes to CASELINE_REPORT_DIR/cctv-kit/&lt;label&gt;, never into the project.
    /// The label comes from CASELINE_STILLS_LABEL. Skinned meshes are frozen into plain meshes for the render because
    /// outside play mode Camera.Render does not refresh skinning.
    /// </summary>
    public static class CCTVKitQaStills
    {
        private const int Width = 960;
        private const int Height = 540;

        // The bridge's fixed presets (lib/art/unity-cctv-bridge.ts CAMERA_PRESETS).
        private static readonly Dictionary<string, (float[] position, float[] rotation)> Presets = new()
        {
            ["corridor"] = (new[] { 0f, 3.6f, -5.4f }, new[] { 17.819f, 0f, 0f }),
            ["generic"] = (new[] { -6.357f, 4.8f, -3.357f }, new[] { 23.452f, 45f, 0f }),
        };

        [MenuItem("Tools/CASELINE/Render CCTV Kit QA Stills")]
        public static void Render()
        {
            EditorSceneManager.OpenScene("Assets/Scenes/CCTVEmbed.unity", OpenSceneMode.Single);
            var scene = Object.FindFirstObjectByType<CCTVSceneController>();
            var playback = Object.FindFirstObjectByType<CCTVPlaybackController>();
            var sceneCamera = Object.FindFirstObjectByType<Camera>();

            var label = Environment.GetEnvironmentVariable("CASELINE_STILLS_LABEL");
            if (string.IsNullOrEmpty(label)) label = "current";
            var root = Environment.GetEnvironmentVariable("CASELINE_REPORT_DIR");
            if (string.IsNullOrEmpty(root)) root = Path.Combine(Path.GetTempPath(), "caseline-report");
            var outDir = Path.Combine(root, "cctv-kit", label);
            Directory.CreateDirectory(outDir);

            var qaCamera = new GameObject("QaCctvCamera").AddComponent<Camera>();
            qaCamera.enabled = false;
            var target = new RenderTexture(Width, Height, 24);
            qaCamera.targetTexture = target;

            try
            {
                foreach (var (kind, preset) in Presets)
                {
                    var scenario = new CCTVScenarioData
                    {
                        version = CCTVJsonLoader.SupportedVersion,
                        scene = kind,
                        camera = new CCTVCameraData { id = "camera-qa-" + kind, position = preset.position, rotation = preset.rotation },
                        durationSeconds = 20f,
                        actors = new[]
                        {
                            new CCTVActorData { visualId = "actor-0", identified = false, startTime = 0f, endTime = 20f, startPosition = new[] { -9f, 0f, 3f }, endPosition = new[] { 9f, 0f, 3f }, walkSpeed = 0.9f },
                        },
                    };
                    scene.ApplyScenario(scenario);
                    playback.Pause();

                    foreach (var t in new[] { 0.5f, 5f, 10f, 15f })
                    {
                        playback.Seek(t);
                        var frozen = new List<GameObject>();
                        foreach (var controller in Object.FindObjectsByType<CCTVActorController>(FindObjectsInactive.Exclude, FindObjectsSortMode.None))
                        {
                            foreach (var animator in controller.GetComponentsInChildren<Animator>()) animator.Update(0f);
                            foreach (var smr in controller.GetComponentsInChildren<SkinnedMeshRenderer>())
                            {
                                var baked = new Mesh();
                                smr.BakeMesh(baked, true);
                                var go = new GameObject("QaFrozen");
                                go.transform.SetPositionAndRotation(smr.transform.position, smr.transform.rotation);
                                go.AddComponent<MeshFilter>().sharedMesh = baked;
                                go.AddComponent<MeshRenderer>().sharedMaterials = smr.sharedMaterials;
                                smr.enabled = false;
                                frozen.Add(go);
                            }
                        }

                        qaCamera.transform.SetPositionAndRotation(sceneCamera.transform.position, sceneCamera.transform.rotation);
                        qaCamera.fieldOfView = sceneCamera.fieldOfView;
                        qaCamera.aspect = (float)Width / Height;
                        qaCamera.nearClipPlane = 0.1f;
                        qaCamera.farClipPlane = 200f;
                        qaCamera.clearFlags = sceneCamera.clearFlags;
                        qaCamera.backgroundColor = sceneCamera.backgroundColor;
                        qaCamera.Render();

                        var previous = RenderTexture.active;
                        RenderTexture.active = target;
                        var tex = new Texture2D(Width, Height, TextureFormat.RGB24, false);
                        tex.ReadPixels(new Rect(0, 0, Width, Height), 0, 0);
                        RenderTexture.active = previous;
                        File.WriteAllBytes(Path.Combine(outDir, $"{kind}-t{t:F1}.png"), tex.EncodeToPNG());
                        Object.DestroyImmediate(tex);

                        foreach (var go in frozen)
                        {
                            Object.DestroyImmediate(go.GetComponent<MeshFilter>().sharedMesh);
                            Object.DestroyImmediate(go);
                        }
                        foreach (var controller in Object.FindObjectsByType<CCTVActorController>(FindObjectsInactive.Include, FindObjectsSortMode.None))
                        {
                            foreach (var smr in controller.GetComponentsInChildren<SkinnedMeshRenderer>(true)) smr.enabled = true;
                        }
                    }
                }
            }
            finally
            {
                qaCamera.targetTexture = null;
                Object.DestroyImmediate(target);
                Object.DestroyImmediate(qaCamera.gameObject);
            }
            Debug.Log($"[CCTV] kit stills ({label}) written to {outDir}");
        }
    }
}
