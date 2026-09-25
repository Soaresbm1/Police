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
        private const float WallHeight = 3f;
        private const float FloorHalfExtent = 8f;

        private static Mesh cubeMesh;
        private static Mesh planeMesh;

        public void Build(string environment, Material floorMat, Material wallMat, Material propMat, Material zoneMarkerMat)
        {
            var children = new List<GameObject>();
            foreach (Transform child in transform) children.Add(child.gameObject);
            foreach (var child in children)
            {
                if (Application.isPlaying) Object.Destroy(child);
                else Object.DestroyImmediate(child);
            }

            BuildFloor(floorMat);
            BuildBoundaryWalls(wallMat);
            BuildBaseboardTrim(propMat);
            BuildZoneMarkers(environment, zoneMarkerMat);
            BuildEnvironmentProps(environment, propMat);
        }

        private void BuildFloor(Material mat)
        {
            var floor = CreateMeshObject("Floor", GetPlaneMesh(), mat);
            floor.transform.SetParent(transform, false);
            floor.transform.localScale = new Vector3(FloorHalfExtent / 5f, 1f, FloorHalfExtent / 5f);
        }

        private void BuildBoundaryWalls(Material mat)
        {
            foreach (var bounds in WallBounds) AddBox("Wall", bounds, mat);
        }

        private static readonly Bounds[] WallBounds =
        {
            new(new Vector3(0, WallHeight / 2f, -FloorHalfExtent), new Vector3(FloorHalfExtent * 2f, WallHeight, 0.3f)),
            new(new Vector3(0, WallHeight / 2f, FloorHalfExtent), new Vector3(FloorHalfExtent * 2f, WallHeight, 0.3f)),
            new(new Vector3(-FloorHalfExtent, WallHeight / 2f, 0), new Vector3(0.3f, WallHeight, FloorHalfExtent * 2f)),
            new(new Vector3(FloorHalfExtent, WallHeight / 2f, 0), new Vector3(0.3f, WallHeight, FloorHalfExtent * 2f)),
        };

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
            var all = new List<Bounds>(WallBounds);
            all.AddRange(PropBounds(environment));
            return all;
        }

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
            "shop" => new[]
            {
                new Bounds(new Vector3(-1f, 0.5f, 4f), new Vector3(2.5f, 1f, 0.6f)), // counter
                new Bounds(new Vector3(-6.2f, 1.1f, 0f), new Vector3(0.5f, 2.2f, 10f)), // back-wall shelving run — depth/recognition, far behind every slot
            },
            "corridor" => new[]
            {
                new Bounds(new Vector3(0f, 1.5f, -FloorHalfExtent + 0.5f), new Vector3(1.2f, 2.2f, 0.15f)), // doorway frame hint
                new Bounds(new Vector3(-3f, 1.35f, FloorHalfExtent - 0.15f), new Vector3(1f, 2.1f, 0.2f)), // second doorway recess, opposite wall — architectural rhythm
                new Bounds(new Vector3(3f, 1.35f, -FloorHalfExtent + 0.15f), new Vector3(1f, 2.1f, 0.2f)), // third doorway recess — even rhythm along the corridor's length
            },
            "street" => new[]
            {
                new Bounds(new Vector3(-6f, 2f, 6f), new Vector3(2f, 4f, 2f)), // building silhouette
                new Bounds(new Vector3(6f, 2.5f, 6f), new Vector3(2f, 5f, 2f)), // building silhouette
                new Bounds(new Vector3(0f, 1.75f, 7.7f), new Vector3(1.6f, 3.5f, 1.6f)), // third, more distant building — depth recession behind the street line
            },
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
