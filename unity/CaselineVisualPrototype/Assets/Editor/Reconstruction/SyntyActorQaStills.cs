using System.IO;
using System.Linq;
using Caseline.Reconstruction;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Caseline.ReconstructionEditor
{
    /// <summary>
    /// Dev-only visual QA for the optional character kit: a corridor scenario whose actors carry real genericAppearance
    /// strings (the synthetic QA scenarios use none the kit knows, so they stay mannequins), rendered at every named beat
    /// through the real director camera. Needs a graphics device (batch mode WITHOUT -nographics). Output goes to
    /// CASELINE_REPORT_DIR/synty/&lt;label&gt;, never into the project. Label comes from CASELINE_STILLS_LABEL.
    /// </summary>
    public static class SyntyActorQaStills
    {
        private const int Width = 960;
        private const int Height = 600;

        [MenuItem("Tools/CASELINE/Render Synty Actor QA Stills")]
        public static void Render()
        {
            EditorSceneManager.OpenScene("Assets/Scenes/ReconstructionPrototype.unity", OpenSceneMode.Single);
            var scene = Object.FindFirstObjectByType<ReconstructionSceneController>();
            foreach (var cam in Object.FindObjectsByType<Camera>(FindObjectsInactive.Include, FindObjectsSortMode.None)) cam.enabled = false;

            var label = System.Environment.GetEnvironmentVariable("CASELINE_STILLS_LABEL");
            if (string.IsNullOrEmpty(label)) label = "current";
            var outDir = Path.Combine(Path.GetDirectoryName(ReconstructionCameraMatrix.ReportPath("x"))!, "synty", label);
            Directory.CreateDirectory(outDir);

            var qaCamera = new GameObject("QaSyntyCamera").AddComponent<Camera>();
            qaCamera.enabled = false;
            var target = new RenderTexture(Width, Height, 24);
            qaCamera.targetTexture = target;
            var appearances = new[] { "formal_light", "casual_dark", "workwear_neutral", "outerwear_light" };

            try
            {
                foreach (var env in new[] { "corridor", "generic" })
                {
                    var scenario = ReconstructionCameraMatrix.BuildScenario(env, "attack_strike", presentRole: "accomplice");
                    for (var i = 0; i < scenario.actors.Count; i++) scenario.actors[i].genericAppearance = appearances[i % appearances.Length];
                    scene.ClearScenario();
                    scene.ApplyScenario(scenario);

                    // The named beats, plus a few instants inside the fall: the motion-capture death clip must not show a
                    // weapon-ready stance on its way down.
                    var samples = ReconstructionCameraMatrix.SamplesFor(scenario).ToList();
                    foreach (var t in new[] { 32.0f, 32.4f, 32.8f, 33.2f }) samples.Add(new ReconstructionCameraMatrix.Sample($"fall_{t:F1}", t, true, default));
                    foreach (var sample in samples)
                    {
                        scene.Evaluate(sample.Time);
                        foreach (var actor in scene.SpawnedActors)
                        {
                            if (actor == null || !actor.gameObject.activeSelf) continue;
                            var animator = actor.GetComponent<Animator>();
                            if (animator != null) animator.Update(0f);
                            var pose = ReconstructionActorTimeline.Evaluate(actor.Data, actor.Events, actor.Environment, sample.Time, actor.AllActors);
                            var hand = actor.transform.Find("Model/Root/Hips/Spine_01/Spine_02/Spine_03/Clavicle_R/Shoulder_R/Elbow_R/Hand_R");
                            var hips = actor.transform.Find("Model/Root/Hips");
                            var state = animator != null ? animator.GetCurrentAnimatorStateInfo(0) : default;
                            Debug.Log($"[SyntyQA] {env}/{sample.Name} t={sample.Time:F1} role={actor.Data.roleForReconstruction} anim={pose.animState} nt={pose.normalizedTime:F2} kit={actor.GetComponent<ReconstructionKitActor>() != null} animator={(animator != null ? animator.runtimeAnimatorController?.name : "none")} stateHash={state.shortNameHash} normalized={state.normalizedTime:F2} hips.y={(hips != null ? hips.position.y : -1f):F2} hand={(hand != null ? hand.position.ToString("F2") : "-")}");
                        }

                        // Outside play mode Camera.Render does not refresh skinning (the player loop does that), so a skinned
                        // person would render in whatever pose it last had. Freeze each one into a plain mesh in its current
                        // pose for the render only; the real player skins every frame.
                        var frozen = new System.Collections.Generic.List<GameObject>();
                        foreach (var actor in scene.SpawnedActors)
                        {
                            if (actor == null || !actor.gameObject.activeSelf) continue;
                            foreach (var smr in actor.GetComponentsInChildren<SkinnedMeshRenderer>())
                            {
                                var baked = new Mesh();
                                smr.BakeMesh(baked, true);
                                var go = new GameObject("QaFrozen");
                                go.transform.SetPositionAndRotation(smr.transform.position, smr.transform.rotation);
                                go.AddComponent<MeshFilter>().sharedMesh = baked;
                                var mr = go.AddComponent<MeshRenderer>();
                                mr.sharedMaterials = smr.sharedMaterials;
                                mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.On;
                                smr.enabled = false;
                                frozen.Add(go);
                            }
                        }

                        var shot = ReconstructionCameraMatrix.DirectorSelector(scenario, sample.Time);
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
                        tex.Apply();
                        File.WriteAllBytes(Path.Combine(outDir, $"{env}-{sample.Name}.png"), tex.EncodeToPNG());
                        Object.DestroyImmediate(tex);
                        foreach (var go in frozen)
                        {
                            Object.DestroyImmediate(go.GetComponent<MeshFilter>().sharedMesh);
                            Object.DestroyImmediate(go);
                        }
                        foreach (var actor in scene.SpawnedActors)
                        {
                            if (actor == null) continue;
                            foreach (var smr in actor.GetComponentsInChildren<SkinnedMeshRenderer>(true)) smr.enabled = true;
                        }
                    }
                }
            }
            finally
            {
                scene.ClearScenario();
                qaCamera.targetTexture = null;
                Object.DestroyImmediate(target);
                Object.DestroyImmediate(qaCamera.gameObject);
            }
            Debug.Log($"[Reconstruction] synty actor stills ({label}) written to {outDir}");
        }
    }
}
