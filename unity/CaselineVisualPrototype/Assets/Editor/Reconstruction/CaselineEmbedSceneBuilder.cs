using System.Collections.Generic;
using System.IO;
using Caseline.CCTVEditor;
using Caseline.Reconstruction;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Caseline.ReconstructionEditor
{
    /// <summary>
    /// Builds the production embed scene shared by CCTV and the crime reconstruction, so one WebGL runtime serves
    /// both viewers: CCTV's own embed scene, as CCTVPrototypeBuilder produces it, under "CCTVRoot"; the
    /// reconstruction, with its player-facing HUD, under "ReconstructionRoot" (inactive until requested); and
    /// "EmbedMode", the only object the host page addresses to switch between them.
    /// </summary>
    public static class CaselineEmbedSceneBuilder
    {
        public const string ScenePath = "Assets/Scenes/CaselineEmbed.unity";
        private const string CctvEmbedScenePath = "Assets/Scenes/CCTVEmbed.unity";
        private const string BrotliOutputFolder = "SharedEmbedBrotli";

        [MenuItem("Tools/CASELINE/Build Shared Embed Scene (CCTV + Reconstruction)")]
        public static void BuildScene()
        {
            CCTVPrototypeBuilder.BuildEmbedScene();
            var scene = EditorSceneManager.OpenScene(CctvEmbedScenePath, OpenSceneMode.Single);
            var cctvAmbient = RenderSettings.ambientLight;

            var cctvRoot = new GameObject("CCTVRoot");
            foreach (var go in scene.GetRootGameObjects())
            {
                if (go != cctvRoot) go.transform.SetParent(cctvRoot.transform, true);
            }

            var cctvRoots = new HashSet<GameObject>(scene.GetRootGameObjects());
            var reconstruction = ReconstructionSceneBuilder.PopulateReconstruction(developerHud: false);
            var reconstructionRoot = new GameObject("ReconstructionRoot");
            foreach (var go in scene.GetRootGameObjects())
            {
                if (go != reconstructionRoot && !cctvRoots.Contains(go)) go.transform.SetParent(reconstructionRoot.transform, true);
            }

            var bridgeGo = new GameObject("ReconstructionWebBridge");
            bridgeGo.transform.SetParent(reconstructionRoot.transform, false);
            var bridge = bridgeGo.AddComponent<ReconstructionWebBridge>();
            bridge.Configure(reconstruction.playback);

            var modeController = new GameObject("EmbedMode").AddComponent<CaselineEmbedModeController>();
            modeController.Configure(cctvRoot, reconstructionRoot, bridge, reconstruction.scene, cctvAmbient, ReconstructionSceneBuilder.AmbientLight);

            reconstructionRoot.SetActive(false);
            RenderSettings.ambientLight = cctvAmbient;

            EditorSceneManager.MarkSceneDirty(scene);
            EditorSceneManager.SaveScene(scene, ScenePath);
            Debug.Log($"[Embed] Shared embed scene built and saved to {ScenePath}");
        }

        /// <summary>Release Brotli build of the shared embed scene. Output stays local under SharedEmbedBrotli/;
        /// publishing it to public/unity/cctv/Build is a separate, explicit copy step.</summary>
        [MenuItem("Tools/CASELINE/Build Shared Embed WebGL (Brotli)")]
        public static void BuildWebGLBrotli()
        {
            var buildDir = Path.Combine(Directory.GetParent(Application.dataPath)!.FullName, BrotliOutputFolder);
            Directory.CreateDirectory(buildDir);

            var previousCompression = PlayerSettings.WebGL.compressionFormat;
            var previousDevelopment = EditorUserBuildSettings.development;
            PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Brotli;
            EditorUserBuildSettings.development = false;

            try
            {
                var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions
                {
                    scenes = new[] { ScenePath },
                    locationPathName = buildDir,
                    target = BuildTarget.WebGL,
                    options = BuildOptions.None,
                });
                Debug.Log($"[Embed] Brotli WebGL build result: {report.summary.result}, size={report.summary.totalSize} bytes, errors={report.summary.totalErrors}");
            }
            finally
            {
                PlayerSettings.WebGL.compressionFormat = previousCompression;
                EditorUserBuildSettings.development = previousDevelopment;
            }
        }
    }
}
