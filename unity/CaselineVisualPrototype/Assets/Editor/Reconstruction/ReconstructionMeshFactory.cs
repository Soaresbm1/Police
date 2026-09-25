using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

namespace Caseline.ReconstructionEditor
{
    /// <summary>
    /// U5.6 iteration 4 — deterministic low-poly meshes for the Reconstruction mannequin's LARGE forms: tapered boxes
    /// (torso, pelvis, arms, legs) and faceted ellipsoids (head, joint caps). Each mesh is saved as an asset under
    /// Resources/ReconstructionMeshes so the baked scene/WebGL build references it by GUID (a procedural mesh that only
    /// lives in memory would not survive the scene save). Flat-shaded (a vertex per face corner) so the facets read as an
    /// intentional stylized mannequin rather than a smooth Unity primitive. Editor-only; contains no randomness.
    /// </summary>
    public static class ReconstructionMeshFactory
    {
        private const string Folder = "Assets/Resources/ReconstructionMeshes";

        /// <summary>A box of the given height (centered on the origin) whose bottom and top rectangles have independent
        /// half-extents — i.e. a frustum, which is what turns a stack of cubes into a tapered limb or torso.</summary>
        public static Mesh Taper(string name, float bottomHalfX, float bottomHalfZ, float topHalfX, float topHalfZ, float height)
        {
            var b = -height / 2f;
            var t = height / 2f;
            var bl = new Vector3(-bottomHalfX, b, -bottomHalfZ);
            var br = new Vector3(bottomHalfX, b, -bottomHalfZ);
            var fr = new Vector3(bottomHalfX, b, bottomHalfZ);
            var fl = new Vector3(-bottomHalfX, b, bottomHalfZ);
            var tbl = new Vector3(-topHalfX, t, -topHalfZ);
            var tbr = new Vector3(topHalfX, t, -topHalfZ);
            var tfr = new Vector3(topHalfX, t, topHalfZ);
            var tfl = new Vector3(-topHalfX, t, topHalfZ);

            var builder = new MeshBuilder();
            builder.Quad(bl, br, fr, fl); // bottom
            builder.Quad(tfl, tfr, tbr, tbl); // top
            builder.Quad(bl, tbl, tbr, br); // back
            builder.Quad(fr, tfr, tfl, fl); // front
            builder.Quad(fl, tfl, tbl, bl); // left
            builder.Quad(br, tbr, tfr, fr); // right
            return Save(name, builder);
        }

        /// <summary>Faceted unit ellipsoid (diameter 1 on every axis) with an optional narrowing toward the bottom so
        /// the same generator yields both a plain low-poly ball (joint caps, jawFactor 1) and a neutral mannequin head
        /// (egg-like, narrower jaw). No face, hair or identity detail — just a smooth-enough silhouette.</summary>
        public static Mesh FacetedSphere(string name, int segments, int rings, float jawFactor)
        {
            var builder = new MeshBuilder();
            Vector3 P(int ring, int seg)
            {
                var lat = Mathf.PI / 2f - Mathf.PI * ring / rings;
                var az = 2f * Mathf.PI * seg / segments;
                var y = Mathf.Sin(lat) * 0.5f;
                var radial = Mathf.Cos(lat) * 0.5f;
                if (y < 0f) radial *= Mathf.Lerp(1f, jawFactor, -y / 0.5f);
                return new Vector3(radial * Mathf.Cos(az), y, radial * Mathf.Sin(az));
            }

            for (var r = 0; r < rings; r++)
            {
                for (var s = 0; s < segments; s++)
                {
                    var a = P(r, s);
                    var b = P(r, s + 1);
                    var c = P(r + 1, s + 1);
                    var d = P(r + 1, s);
                    builder.Tri(a, b, c);
                    builder.Tri(a, c, d);
                }
            }
            return Save(name, builder);
        }

        public static int TriangleCount(Mesh mesh) => mesh == null ? 0 : mesh.triangles.Length / 3;

        private static Mesh Save(string name, MeshBuilder builder)
        {
            EnsureFolder();
            var path = $"{Folder}/{name}.asset";
            var mesh = AssetDatabase.LoadAssetAtPath<Mesh>(path);
            var isNew = mesh == null;
            if (isNew) mesh = new Mesh { name = name };
            builder.Fill(mesh);
            if (isNew) AssetDatabase.CreateAsset(mesh, path);
            else EditorUtility.SetDirty(mesh);
            return mesh;
        }

        private static void EnsureFolder()
        {
            if (!AssetDatabase.IsValidFolder("Assets/Resources")) AssetDatabase.CreateFolder("Assets", "Resources");
            if (!AssetDatabase.IsValidFolder(Folder)) AssetDatabase.CreateFolder("Assets/Resources", "ReconstructionMeshes");
        }

        private sealed class MeshBuilder
        {
            private readonly List<Vector3> vertices = new();
            private readonly List<Vector3> normals = new();
            private readonly List<int> triangles = new();

            public void Quad(Vector3 a, Vector3 b, Vector3 c, Vector3 d)
            {
                Tri(a, b, c);
                Tri(a, c, d);
            }

            /// <summary>Adds one flat-shaded triangle wound so its normal points away from the origin (every mesh
            /// here is convex around its own center). Degenerate (zero-area) triangles — a pole ring, a collapsed
            /// edge — are skipped.</summary>
            public void Tri(Vector3 a, Vector3 b, Vector3 c)
            {
                var n = Vector3.Cross(b - a, c - a);
                if (n.sqrMagnitude < 1e-10f) return;
                if (Vector3.Dot(n, (a + b + c) / 3f) < 0f)
                {
                    (b, c) = (c, b);
                    n = -n;
                }
                n.Normalize();
                var i = vertices.Count;
                vertices.Add(a);
                vertices.Add(b);
                vertices.Add(c);
                normals.Add(n);
                normals.Add(n);
                normals.Add(n);
                triangles.Add(i);
                triangles.Add(i + 1);
                triangles.Add(i + 2);
            }

            public void Fill(Mesh mesh)
            {
                mesh.Clear();
                mesh.SetVertices(vertices);
                mesh.SetNormals(normals);
                mesh.SetTriangles(triangles, 0);
                mesh.RecalculateBounds();
            }
        }
    }
}
