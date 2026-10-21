using System;
using System.IO;
using System.Linq;
using System.Text;
using UnityEditor;
using UnityEngine;

namespace Caseline.ReconstructionEditor
{
    /// <summary>Dev-only: dumps the structure of the locally installed Synty character prefabs (skeleton, which skinned
    /// meshes are enabled, rest pose) to CASELINE_REPORT_DIR, so the retargeting in SyntyActorBuilder is built on what
    /// the rig really looks like.</summary>
    public static class SyntyCharacterReport
    {
        [MenuItem("Tools/CASELINE/Report Synty Characters")]
        public static void Report()
        {
            var sb = new StringBuilder();
            var guids = AssetDatabase.FindAssets("t:Prefab", new[] { OfficeKitBuilder.PackRoot + "/Prefabs/Characters" });
            foreach (var path in guids.Select(AssetDatabase.GUIDToAssetPath).Where(p => Path.GetFileName(p).StartsWith("SM_Chr_Business_Male_01") || Path.GetFileName(p).StartsWith("SM_Chr_Developer_Female_01")))
            {
                var instance = (GameObject)PrefabUtility.InstantiatePrefab(AssetDatabase.LoadAssetAtPath<GameObject>(path));
                sb.AppendLine($"=== {path}");
                sb.AppendLine($"root: {instance.name} pos={instance.transform.position} scale={instance.transform.localScale} animator={instance.GetComponent<Animator>() != null}");
                var smrs = instance.GetComponentsInChildren<SkinnedMeshRenderer>(true);
                sb.AppendLine($"skinned renderers: {smrs.Length}");
                foreach (var s in smrs)
                {
                    sb.AppendLine($"  {s.name} enabled={s.enabled} active={s.gameObject.activeInHierarchy} verts={(s.sharedMesh != null ? s.sharedMesh.vertexCount : 0)} bones={s.bones.Length} rootBone={(s.rootBone != null ? s.rootBone.name : "-")} mats={string.Join(",", s.sharedMaterials.Select(m => m != null ? m.name : "null"))} size={s.bounds.size}");
                }
                var mrs = instance.GetComponentsInChildren<MeshRenderer>(true);
                sb.AppendLine($"mesh renderers: {mrs.Length}");
                foreach (var m in mrs) sb.AppendLine($"  {m.name} enabled={m.enabled} active={m.gameObject.activeInHierarchy} parent={m.transform.parent.name}");

                sb.AppendLine("hierarchy (name | local pos | world pos | active):");
                Dump(instance.transform, 0, sb);

                var mesh = smrs.FirstOrDefault(s => s.sharedMesh != null)?.sharedMesh;
                if (mesh != null)
                {
                    var meshPath = AssetDatabase.GetAssetPath(mesh);
                    var importer = AssetImporter.GetAtPath(meshPath) as ModelImporter;
                    sb.AppendLine($"fbx={meshPath} animationType={(importer != null ? importer.animationType.ToString() : "?")} scale={(importer != null ? importer.globalScale : 0)}");
                }
                UnityEngine.Object.DestroyImmediate(instance);
            }

            var dir = Environment.GetEnvironmentVariable("CASELINE_REPORT_DIR");
            if (string.IsNullOrEmpty(dir)) dir = Path.Combine(Path.GetTempPath(), "caseline-report");
            Directory.CreateDirectory(dir);
            File.WriteAllText(Path.Combine(dir, "synty-characters.txt"), sb.ToString());
        }

        private static void Dump(Transform t, int depth, StringBuilder sb)
        {
            if (depth > 9) return;
            sb.AppendLine($"{new string(' ', depth * 2)}{t.name} | {t.localPosition.x:F3},{t.localPosition.y:F3},{t.localPosition.z:F3} | {t.position.x:F3},{t.position.y:F3},{t.position.z:F3} | {t.gameObject.activeSelf}");
            foreach (Transform child in t) Dump(child, depth + 1, sb);
        }
    }
}
