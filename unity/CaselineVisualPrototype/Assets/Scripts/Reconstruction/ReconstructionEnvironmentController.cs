using System.Collections.Generic;
using UnityEngine;

namespace Caseline.Reconstruction
{
    /// <summary>
    /// Phase U5.2 — builds a small, readable, deterministic environment for
    /// one of the 5 reconstruction environment kinds. A SEPARATE system
    /// from <c>CCTVEnvironmentController</c> (never referenced, never
    /// modified) — reconstruction needs closer, more legible spatial
    /// staging than a wide fixed surveillance shot does (req. 7).
    ///
    /// Deliberately minimal per this phase's explicit instructions: floor,
    /// boundary walls where appropriate, the 5 semantic-slot zone markers,
    /// and at most one or two environment-flavor props — never an evidence
    /// prop, never fake blood, never a random weapon lying around, never an
    /// extra person. If a future phase needs richer scenery, it belongs
    /// here, not layered onto CCTV's environment system.
    ///
    /// Builds GameObjects from `MeshFilter`/`MeshRenderer` directly rather
    /// than `GameObject.CreatePrimitive` — the same fix
    /// `CCTVEnvironmentController` already needed for the identical reason:
    /// `CreatePrimitive`'s own internal "attach a Collider" step throws
    /// under WebGL builds, which strip the Physics module when nothing else
    /// in the project needs it. Reuses the exact same pre-baked mesh assets
    /// CCTV's own Editor tooling already extracts to `Resources/CCTVMeshes/`
    /// (`CCTVPrototypeBuilder.BakePrimitiveMeshes`) — reading a shared,
    /// already-existing data asset, not touching or duplicating any CCTV
    /// code. No Collider is ever added, which is fine: this environment
    /// never needs physics/raycasts.
    /// </summary>
    public class ReconstructionEnvironmentController : MonoBehaviour
    {
        private const float FloorHalfExtent = ReconstructionEnvironmentStructure.FloorHalfExtent;

        private static Mesh cubeMesh;
        private static Mesh planeMesh;

        // Derived material groups (see SceneryMaterial): cloned from the scene's prop material so they share its shader,
        // one instance per group per Build, released on the next Build.
        private readonly List<Material> derivedMaterials = new();

        public void Build(string environment, Material floorMat, Material wallMat, Material propMat, Material zoneMarkerMat)
        {
            var children = new List<GameObject>();
            foreach (Transform child in transform) children.Add(child.gameObject);
            foreach (var child in children)
            {
                if (Application.isPlaying) Object.Destroy(child);
                else Object.DestroyImmediate(child);
            }
            ReleaseDerivedMaterials();

            BuildFloor(environment, floorMat);
            BuildBoundaryWalls(environment, wallMat);
            if (ReconstructionEnvironmentStructure.UsesStandardTrim(environment)) BuildBaseboardTrim(propMat);
            BuildZoneMarkers(environment, zoneMarkerMat);
            BuildEnvironmentProps(environment, propMat);

            // The optional office kit (see ReconstructionOfficeKit) dresses the architecture and adds a few background
            // furnishings. Everything it draws lives under one child so budgets and cleanup can tell it apart, and when
            // the kit is not installed this is all skipped and the plain boxes below are drawn exactly as before.
            Transform kitRoot = null;
            if (ReconstructionOfficeKit.IsAvailable)
            {
                var kit = new GameObject(KitRootName);
                kit.transform.SetParent(transform, false);
                kitRoot = kit.transform;
            }
            BuildStructure(environment, wallMat, propMat, kitRoot);
            BuildOfficeDressing(environment, kitRoot);
        }

        /// <summary>Name of the child that holds everything the optional office kit draws.</summary>
        public const string KitRootName = "OfficeKit";

        private static void BuildOfficeDressing(string environment, Transform kitRoot)
        {
            if (kitRoot == null) return;
            foreach (var item in ReconstructionOfficeDressing.Items(environment))
            {
                ReconstructionOfficeKit.Place(kitRoot, item.Prefab, item.Name, item.Footprint, OfficeFit.Height, item.Yaw);
            }
        }

        private void ReleaseDerivedMaterials()
        {
            foreach (var material in derivedMaterials)
            {
                if (material == null) continue;
                if (Application.isPlaying) Object.Destroy(material);
                else Object.DestroyImmediate(material);
            }
            derivedMaterials.Clear();
        }

        private void BuildFloor(string environment, Material mat)
        {
            var size = ReconstructionEnvironmentStructure.FloorSize(environment);
            var floor = CreateMeshObject("Floor", GetPlaneMesh(), mat);
            floor.transform.SetParent(transform, false);
            floor.transform.localScale = new Vector3(size.x / 10f, 1f, size.y / 10f);
        }

        private void BuildBoundaryWalls(string environment, Material mat)
        {
            foreach (var bounds in ReconstructionEnvironmentStructure.Walls(environment)) AddBox("Wall", bounds, mat);
        }

        /// <summary>Generic architecture for this environment kind (U5.7), drawn from a handful of shared material
        /// groups. Wall and Prop use the scene's own materials; the rest are derived once per group.</summary>
        private void BuildStructure(string environment, Material wallMat, Material propMat, Transform kitRoot)
        {
            var byGroup = new Dictionary<SceneryMaterial, Material>
            {
                [SceneryMaterial.Wall] = wallMat,
                [SceneryMaterial.Prop] = propMat,
            };
            var seen = new Dictionary<string, int>();
            foreach (var piece in ReconstructionEnvironmentStructure.Pieces(environment))
            {
                // The kit may take over a piece (drawing a real door where the box was) or retire it; the piece's bounds
                // stay in the structure data either way, so occlusion is measured against the same geometry.
                if (kitRoot != null)
                {
                    seen.TryGetValue(piece.Name, out var occurrence);
                    seen[piece.Name] = occurrence + 1;
                    var skin = ReconstructionOfficeSkins.For(environment, piece.Name, occurrence);
                    if (skin.HasValue)
                    {
                        if (skin.Value.Hide) continue;
                        if (ReconstructionOfficeKit.Place(kitRoot, skin.Value.Prefab, piece.Name, piece.Bounds, skin.Value.Fit, skin.Value.Yaw) != null) continue;
                    }
                }

                if (!byGroup.TryGetValue(piece.Material, out var mat))
                {
                    mat = propMat != null ? new Material(propMat) { name = $"Reconstruction_{piece.Material}", color = ReconstructionEnvironmentPalette.ColorOf(piece.Material) } : null;
                    if (mat != null) derivedMaterials.Add(mat);
                    byGroup[piece.Material] = mat;
                }
                AddBox(piece.Name, piece.Bounds, mat);
            }
        }

        // U5.6 iteration 4 — a low, light baseboard strip along the foot of each boundary wall: the one architectural
        // trim line that makes floor and wall read as two different surfaces instead of one grey mass. 0.16m tall and
        // flush against the wall (|x| or |z| = FloorHalfExtent - 0.19), it sits past every zone slot (|x| <= 7, |z| <= 4)
        // and can never stand between a camera and anyone, so it is deliberately not part of OccluderBounds.
        private static readonly Bounds[] TrimBounds =
        {
            new(new Vector3(0, 0.08f, -(FloorHalfExtent - 0.19f)), new Vector3(FloorHalfExtent * 2f - 0.4f, 0.16f, 0.08f)),
            new(new Vector3(0, 0.08f, FloorHalfExtent - 0.19f), new Vector3(FloorHalfExtent * 2f - 0.4f, 0.16f, 0.08f)),
            new(new Vector3(-(FloorHalfExtent - 0.19f), 0.08f, 0), new Vector3(0.08f, 0.16f, FloorHalfExtent * 2f - 0.4f)),
            new(new Vector3(FloorHalfExtent - 0.19f, 0.08f, 0), new Vector3(0.08f, 0.16f, FloorHalfExtent * 2f - 0.4f)),
        };

        private void BuildBaseboardTrim(Material mat)
        {
            foreach (var bounds in TrimBounds) AddBox("Trim", bounds, mat);
        }

        /// <summary>Every solid box this environment renders (walls and props), in the environment's local space —
        /// the same data <see cref="Build"/> uses, exposed so occlusion can be measured rather than eyeballed.</summary>
        public static List<Bounds> OccluderBounds(string environment)
        {
            var all = new List<Bounds>(ReconstructionEnvironmentStructure.Walls(environment));
            all.AddRange(PropBounds(environment));
            foreach (var piece in ReconstructionEnvironmentStructure.Pieces(environment))
            {
                if (piece.Occluder) all.Add(piece.Bounds);
            }
            // The office furnishings count whether or not the kit is installed, so the occlusion tests mean the same on every machine.
            foreach (var item in ReconstructionOfficeDressing.Items(environment)) all.Add(item.Footprint);
            return all;
        }

        /// <summary>How many of <see cref="OccluderBounds"/> are the environment's boundary walls (they come first).</summary>
        public static int WallCount(string environment) => ReconstructionEnvironmentStructure.Walls(environment).Count;

        /// <summary>Small flat markers at each semantic slot — a
        /// presentation/readability aid only, not evidence. Every position
        /// comes from <see cref="ReconstructionZoneLayout"/>, the same
        /// table actor pose evaluation uses, so a marker always sits
        /// exactly where an actor visiting that slot will stand.</summary>
        private void BuildZoneMarkers(string environment, Material mat)
        {
            foreach (var slot in ReconstructionSchema.Slots)
            {
                var marker = CreateMeshObject($"Zone_{slot}", GetCubeMesh(), mat);
                marker.transform.SetParent(transform, false);
                var pos = ReconstructionZoneLayout.GetZonePosition(environment, slot);
                marker.transform.localPosition = new Vector3(pos.x, 0.01f, pos.z);
                marker.transform.localScale = new Vector3(0.6f, 0.02f, 0.6f);
            }
        }

        /// <summary>At most one or two generic, non-identifying,
        /// non-evidentiary props per environment kind — purely for visual
        /// variety between the 5 kinds, never anything CaseTruth doesn't
        /// support (req. 7/20).</summary>
        private void BuildEnvironmentProps(string environment, Material mat)
        {
            foreach (var bounds in PropBounds(environment)) AddBox("EnvironmentProp", bounds, mat);
        }

        // Scenery yields to semantic slots: the shop counter, generic partition and parking pillars sit behind every slot, off all camera sightlines and walking paths.
        // U5.5 — the parking pillars stood in the foreground at z = -3, where one hid a third person at the talk and would have stood beside the
        // attack camera's lens. Moved to the back row: still a parking structure, never between a camera and anyone.
        //
        // U5.6 iteration 1 — every environment's zone-slot table (`ReconstructionZoneLayout`) keeps every slot
        // within |x| <= 7, |z| <= 4 across all 5 environment kinds (the farthest is generic's entrance/exit at
        // z = ±4). Every depth cue added below sits at |z| >= 7.5 (or, for street, alongside the existing building
        // silhouettes' own x position) — at least 3.5m of clearance from the nearest slot any actor or camera aim
        // point ever uses, on top of already being flush against/near the boundary wall a normal camera never looks
        // past. `parking` is deliberately left unchanged this iteration: its pillar placement is the one prop set a
        // past visual-QA pass (U5.5) found actually occluding a beat, so it carries materially higher regression
        // risk than the other four and needs its own dedicated occlusion re-check before any addition, not a
        // same-pass change bundled with everything else.
        private static Bounds[] PropBounds(string environment) => environment switch
        {
            "parking" => new[]
            {
                new Bounds(new Vector3(-4.5f, 1.5f, 5f), new Vector3(0.4f, 3f, 0.4f)), // pillar
                new Bounds(new Vector3(4.5f, 1.5f, 5f), new Vector3(0.4f, 3f, 0.4f)), // pillar
            },
            // U5.7 iteration 2 - the shop's counter and shelving now live in ReconstructionEnvironmentStructure.
            "shop" => System.Array.Empty<Bounds>(),
            // U5.7 — the corridor's doorways now live in ReconstructionEnvironmentStructure (they sit on the cut-away
            // corridor's own far wall); the old hints were placed for the previous 16 m square room.
            "corridor" => System.Array.Empty<Bounds>(),
            // U5.7 iteration 2 - the street's building masses now live in ReconstructionEnvironmentStructure.
            "street" => System.Array.Empty<Bounds>(),
            // U5.6 iteration 1 — a second "far-corner" depth prop was tried here and reverted: automated occlusion
            // testing (ReconstructionActionCameraMatrixTests) correctly caught it sitting too close to the
            // Interaction camera's own lens position for this environment. `generic` stays unchanged this
            // iteration rather than risk a second placement without being able to re-verify it visually — exactly
            // the "prefer not adding it" outcome the decoration-limit rule calls for when a candidate doesn't
            // clear the bar on the first safe attempt.
            _ => new[] { new Bounds(new Vector3(-5f, 1f, 4.5f), new Vector3(0.2f, 2f, 3f)) }, // partition wall
        };

        private void AddBox(string name, Bounds bounds, Material mat)
        {
            var box = CreateMeshObject(name, GetCubeMesh(), mat);
            box.transform.SetParent(transform, false);
            box.transform.localPosition = bounds.center;
            box.transform.localScale = bounds.size;
        }

        private static GameObject CreateMeshObject(string name, Mesh mesh, Material mat)
        {
            var go = new GameObject(name);
            var filter = go.AddComponent<MeshFilter>();
            filter.sharedMesh = mesh;
            var renderer = go.AddComponent<MeshRenderer>();
            if (mat != null) renderer.sharedMaterial = mat;
            // The environment only RECEIVES shadows. The people cast them, which is what grounds them on the floor; walls
            // and slabs casting them too put hard-edged dark patches across the floor that read as geometry nobody drew.
            renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            return go;
        }

        private static Mesh GetCubeMesh()
        {
            if (cubeMesh == null) cubeMesh = Resources.Load<Mesh>("CCTVMeshes/Cube");
            return cubeMesh;
        }

        private static Mesh GetPlaneMesh()
        {
            if (planeMesh == null) planeMesh = Resources.Load<Mesh>("CCTVMeshes/Plane");
            return planeMesh;
        }
    }
}

