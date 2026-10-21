using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using UnityEditor;
using UnityEngine;

namespace Caseline.ReconstructionEditor
{
    /// <summary>
    /// Dev-only: turns the locally installed Synty POLYGON Office pack (Assets/ThirdParty/PolygonOffice, gitignored: the
    /// licence forbids redistributing the raw art and this repository is public) into the small, runtime-safe kit the
    /// reconstruction scenery draws from (Assets/Resources/OfficeKit, also gitignored).
    ///
    /// Two jobs:
    ///  1. The pack's materials use URP Shader Graphs that this Built-in project does not have, so they render magenta.
    ///     Every pack material is rewritten onto the "Standard" shader (what the rest of the project uses), reading the
    ///     albedo and emission textures straight from the original .mat file.
    ///  2. Only the pieces listed in <see cref="Kit"/> are copied into Resources, stripped of colliders, lights and
    ///     scripts (WebGL strips the Physics module; scenery never needs it). Everything under Resources ships in the
    ///     build, so the list is kept to what the scenery really places.
    ///
    /// Batch: -executeMethod Caseline.ReconstructionEditor.OfficeKitBuilder.Build. Output report goes to
    /// CASELINE_REPORT_DIR (or Temp), never into the project.
    /// </summary>
    public static class OfficeKitBuilder
    {
        public const string PackRoot = "Assets/ThirdParty/PolygonOffice";
        public const string KitRoot = "Assets/Resources/OfficeKit";

        /// <summary>The curated pieces, by pack prefab name. Neutral architecture and furniture only: no weapon, bottle,
        /// medication, document or anything that could read as evidence (the toy guns, alcohol, pills and inhaler in the
        /// pack are deliberately never listed).</summary>
        public static readonly string[] Kit =
        {
            // architecture
            "SM_Bld_Door_01", "SM_Bld_Door_02", "SM_Bld_Door_04", "SM_Bld_Door_05",
            "SM_Bld_Ceiling_Panel_Light_01",
            // background dressing
            "SM_Prop_Plant_02", "SM_Prop_Plant_04", "SM_Prop_WaterCooler_01", "SM_Prop_Bin_01", "SM_Prop_CoatRack_01",
            "SM_Prop_Sign_Exit_01",
        };

        [MenuItem("Tools/CASELINE/Build Office Kit (Synty POLYGON Office)")]
        public static void Build()
        {
            if (!AssetDatabase.IsValidFolder(PackRoot))
            {
                Debug.LogError($"[OfficeKit] {PackRoot} is not installed on this machine; nothing to build.");
                return;
            }

            var converted = ConvertMaterials();
            var report = new StringBuilder();
            report.AppendLine($"materials converted: {converted}");
            BuildKit(report);
            SyntyActorBuilder.Build(report);

            var dir = Environment.GetEnvironmentVariable("CASELINE_REPORT_DIR");
            if (string.IsNullOrEmpty(dir)) dir = Path.Combine(Path.GetTempPath(), "caseline-report");
            Directory.CreateDirectory(dir);
            var path = Path.Combine(dir, "office-kit-report.txt");
            File.WriteAllText(path, report.ToString());
            Debug.Log($"[OfficeKit] report: {path}\n{report}");
        }

        // ---- materials ----

        private static readonly Regex TextureSlot = new(@"- (?<slot>_[A-Za-z_]+):\s*\r?\n\s*m_Texture: \{fileID: \d+, guid: (?<guid>[0-9a-f]{32})", RegexOptions.Compiled);

        private static int ConvertMaterials()
        {
            var standard = Shader.Find("Standard");
            if (standard == null) throw new InvalidOperationException("Standard shader not found");
            var count = 0;
            foreach (var guid in AssetDatabase.FindAssets("t:Material", new[] { PackRoot + "/Materials" }))
            {
                var path = AssetDatabase.GUIDToAssetPath(guid);
                var material = AssetDatabase.LoadAssetAtPath<Material>(path);
                if (material == null) continue;

                // Read the texture slots from the YAML before the shader swap: with the Shader Graph missing, the slots
                // are not reachable through the Material API.
                var slots = new Dictionary<string, Texture2D>();
                foreach (Match m in TextureSlot.Matches(File.ReadAllText(path)))
                {
                    var texture = AssetDatabase.LoadAssetAtPath<Texture2D>(AssetDatabase.GUIDToAssetPath(m.Groups["guid"].Value));
                    if (texture != null) slots[m.Groups["slot"].Value] = texture;
                }

                material.shader = standard;
                material.color = Color.white;
                material.SetFloat("_Metallic", 0f);
                material.SetFloat("_Glossiness", 0.12f);
                material.SetFloat("_SpecularHighlights", 0f);
                material.SetFloat("_GlossyReflections", 0f);
                if (slots.TryGetValue("_Albedo_Map", out var albedo)) material.mainTexture = albedo;

                var name = material.name;
                if (name.Contains("Glass") || name.Contains("Fishtank") || name.Contains("Bubble"))
                {
                    SetTransparent(material, 0.28f);
                }
                else if (name.StartsWith("Net"))
                {
                    if (slots.TryGetValue("_Alpha_Map", out var alphaMap) || slots.TryGetValue("_Albedo_Map", out alphaMap)) material.mainTexture = alphaMap;
                    SetCutout(material);
                }
                else
                {
                    SetOpaque(material);
                }

                if (slots.TryGetValue("_Emission_Map", out var emission) && !name.Contains("Glass"))
                {
                    material.EnableKeyword("_EMISSION");
                    material.SetTexture("_EmissionMap", emission);
                    material.SetColor("_EmissionColor", Color.white);
                    material.globalIlluminationFlags = MaterialGlobalIlluminationFlags.BakedEmissive;
                }
                EditorUtility.SetDirty(material);
                count++;
            }
            AssetDatabase.SaveAssets();
            return count;
        }

        private static void SetOpaque(Material m)
        {
            m.SetFloat("_Mode", 0f);
            m.SetInt("_SrcBlend", (int)UnityEngine.Rendering.BlendMode.One);
            m.SetInt("_DstBlend", (int)UnityEngine.Rendering.BlendMode.Zero);
            m.SetInt("_ZWrite", 1);
            m.DisableKeyword("_ALPHATEST_ON");
            m.DisableKeyword("_ALPHABLEND_ON");
            m.DisableKeyword("_ALPHAPREMULTIPLY_ON");
            m.renderQueue = -1;
        }

        private static void SetCutout(Material m)
        {
            m.SetFloat("_Mode", 1f);
            m.SetFloat("_Cutoff", 0.5f);
            m.SetInt("_SrcBlend", (int)UnityEngine.Rendering.BlendMode.One);
            m.SetInt("_DstBlend", (int)UnityEngine.Rendering.BlendMode.Zero);
            m.SetInt("_ZWrite", 1);
            m.EnableKeyword("_ALPHATEST_ON");
            m.DisableKeyword("_ALPHABLEND_ON");
            m.DisableKeyword("_ALPHAPREMULTIPLY_ON");
            m.renderQueue = 2450;
        }

        private static void SetTransparent(Material m, float alpha)
        {
            var c = m.color;
            c.a = alpha;
            m.color = c;
            m.SetFloat("_Mode", 2f);
            m.SetInt("_SrcBlend", (int)UnityEngine.Rendering.BlendMode.SrcAlpha);
            m.SetInt("_DstBlend", (int)UnityEngine.Rendering.BlendMode.OneMinusSrcAlpha);
            m.SetInt("_ZWrite", 0);
            m.DisableKeyword("_ALPHATEST_ON");
            m.EnableKeyword("_ALPHABLEND_ON");
            m.DisableKeyword("_ALPHAPREMULTIPLY_ON");
            m.renderQueue = 3000;
        }

        // ---- kit ----

        private static void BuildKit(StringBuilder report)
        {
            if (AssetDatabase.IsValidFolder(KitRoot)) AssetDatabase.DeleteAsset(KitRoot);
            Directory.CreateDirectory(KitRoot);
            AssetDatabase.Refresh();

            var packPrefabs = AssetDatabase.FindAssets("t:Prefab", new[] { PackRoot + "/Prefabs" })
                .Select(AssetDatabase.GUIDToAssetPath)
                .GroupBy(Path.GetFileNameWithoutExtension)
                .ToDictionary(g => g.Key, g => g.First());

            report.AppendLine("name | size (x,y,z) m | centre offset from pivot (x,y,z) | min y | tris | renderers | materials");
            foreach (var name in Kit)
            {
                if (!packPrefabs.TryGetValue(name, out var source))
                {
                    report.AppendLine($"{name} | MISSING");
                    continue;
                }

                var instance = (GameObject)PrefabUtility.InstantiatePrefab(AssetDatabase.LoadAssetAtPath<GameObject>(source));
                PrefabUtility.UnpackPrefabInstance(instance, PrefabUnpackMode.Completely, InteractionMode.AutomatedAction);
                instance.transform.SetPositionAndRotation(Vector3.zero, Quaternion.identity);
                instance.transform.localScale = Vector3.one;

                foreach (var c in instance.GetComponentsInChildren<Collider>(true)) UnityEngine.Object.DestroyImmediate(c);
                foreach (var l in instance.GetComponentsInChildren<Light>(true)) UnityEngine.Object.DestroyImmediate(l);
                foreach (var b in instance.GetComponentsInChildren<MonoBehaviour>(true)) UnityEngine.Object.DestroyImmediate(b);
                foreach (var r in instance.GetComponentsInChildren<Rigidbody>(true)) UnityEngine.Object.DestroyImmediate(r);
                foreach (var r in instance.GetComponentsInChildren<MeshRenderer>(true))
                {
                    r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                    r.receiveShadows = true;
                }

                var renderers = instance.GetComponentsInChildren<MeshRenderer>(true);
                var bounds = renderers.Length > 0 ? renderers[0].bounds : new Bounds();
                foreach (var r in renderers.Skip(1)) bounds.Encapsulate(r.bounds);
                var tris = instance.GetComponentsInChildren<MeshFilter>(true).Where(f => f.sharedMesh != null).Sum(f => f.sharedMesh.triangles.Length / 3);
                var materials = renderers.SelectMany(r => r.sharedMaterials).Where(m => m != null).Distinct().Count();

                report.AppendLine($"{name} | {bounds.size.x:F2},{bounds.size.y:F2},{bounds.size.z:F2} | {bounds.center.x:F2},{bounds.center.y:F2},{bounds.center.z:F2} | {bounds.min.y:F2} | {tris} | {renderers.Length} | {materials}");

                instance.name = name;
                PrefabUtility.SaveAsPrefabAsset(instance, $"{KitRoot}/{name}.prefab");
                UnityEngine.Object.DestroyImmediate(instance);
            }
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
        }
    }
}
