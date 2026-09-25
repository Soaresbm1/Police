using System.Collections.Generic;
using UnityEngine;

namespace Caseline.Reconstruction
{
    /// <summary>The small fixed set of shared material groups the environment structure draws from. Wall and Prop are
    /// the two materials the scene already provides; the others are derived from them at build time (same shader, one
    /// colour each, shared by every piece of that group) so an environment needs a handful of materials, never one per
    /// object.</summary>
    public enum SceneryMaterial
    {
        Wall,
        Prop,
        Recess,
        Ceiling,
        Marking,
    }

    /// <summary>One box of generic architecture. <see cref="Occluder"/> is true for anything that has volume above the
    /// floor; only flat floor decals (a painted line, the ground plate) are exempt, because a 1 cm decal cannot stand
    /// between a camera and a person. Everything else is registered with the occlusion model.</summary>
    public readonly struct SceneryPiece
    {
        public readonly string Name;
        public readonly Bounds Bounds;
        public readonly SceneryMaterial Material;
        public readonly bool Occluder;

        public SceneryPiece(string name, Bounds bounds, SceneryMaterial material, bool occluder = true)
        {
            Name = name;
            Bounds = bounds;
            Material = material;
            Occluder = occluder;
        }
    }

    /// <summary>
    /// Phase U5.7 — the fixed, generic architecture of each reconstruction environment kind. Illustrative only: nothing
    /// here is a factual crime-scene detail, and nothing depends on anything but the environment KIND (no seed, case,
    /// person, role or evidence). No signage, product, vehicle, fixture that implies evidence, or camera placement.
    ///
    /// Identity comes from architecture (proportions, openings, repeated structure, floor/wall hierarchy), not clutter,
    /// and every piece sits behind or above the semantic action so the beat itself stays visually quiet: the actor
    /// slots and their cameras are frozen (U5.5), so the architecture adapts to them.
    /// </summary>
    public static class ReconstructionEnvironmentStructure
    {
        public const float FloorHalfExtent = 8f;
        private const float StandardWallHeight = 3f;
        private const float ParkingWallHeight = 3.6f;

        // Corridor cut-away: the near (camera-side) wall is left open so the fixed cameras can see in, exactly like a
        // section drawing. The far wall stands close behind the action so the space reads as narrow.
        private const float CorridorFarWallCenterZ = 2.6f;
        private const float CorridorFarWallInnerZ = 2.45f;
        private const float CorridorEndInnerX = 7.85f;

        public static IReadOnlyList<Bounds> Walls(string environment)
        {
            switch (environment)
            {
                case "corridor":
                    return new[]
                    {
                        new Bounds(new Vector3(0f, StandardWallHeight / 2f, CorridorFarWallCenterZ), new Vector3(FloorHalfExtent * 2f, StandardWallHeight, 0.3f)),
                        new Bounds(new Vector3(-FloorHalfExtent, StandardWallHeight / 2f, 0f), new Vector3(0.3f, StandardWallHeight, 5.5f)),
                        new Bounds(new Vector3(FloorHalfExtent, StandardWallHeight / 2f, 0f), new Vector3(0.3f, StandardWallHeight, 5.5f)),
                    };
                case "parking":
                    return BoundaryWalls(ParkingWallHeight);
                default:
                    return BoundaryWalls(StandardWallHeight);
            }
        }

        private static Bounds[] BoundaryWalls(float height) => new Bounds[]
        {
            new(new Vector3(0, height / 2f, -FloorHalfExtent), new Vector3(FloorHalfExtent * 2f, height, 0.3f)),
            new(new Vector3(0, height / 2f, FloorHalfExtent), new Vector3(FloorHalfExtent * 2f, height, 0.3f)),
            new(new Vector3(-FloorHalfExtent, height / 2f, 0), new Vector3(0.3f, height, FloorHalfExtent * 2f)),
            new(new Vector3(FloorHalfExtent, height / 2f, 0), new Vector3(0.3f, height, FloorHalfExtent * 2f)),
        };

        /// <summary>Floor extent on x and z (centred on the origin).</summary>
        public static Vector2 FloorSize(string environment) =>
            environment == "corridor" ? new Vector2(FloorHalfExtent * 2f, 5.5f) : new Vector2(FloorHalfExtent * 2f, FloorHalfExtent * 2f);

        /// <summary>False where the environment supplies its own trim in <see cref="Pieces"/>.</summary>
        public static bool UsesStandardTrim(string environment) => environment != "corridor" && environment != "street";

        public static IReadOnlyList<SceneryPiece> Pieces(string environment)
        {
            switch (environment)
            {
                case "corridor": return Corridor();
                case "parking": return Parking();
                case "shop": return Shop();
                case "street": return Street();
                default: return System.Array.Empty<SceneryPiece>();
            }
        }

        private static Bounds Box(float x, float y, float z, float sx, float sy, float sz) => new(new Vector3(x, y, z), new Vector3(sx, sy, sz));

        private static List<SceneryPiece> Corridor()
        {
            var p = new List<SceneryPiece>
            {
                // A dark stage plate so the cut-away floor sits on something instead of floating in the sky.
                new("Ground", Box(0f, -0.03f, 0f, 36f, 0.02f, 36f), SceneryMaterial.Recess, occluder: false),

                // Overhead: one ceiling slab over the 5.5 m corridor footprint (well clear of every camera: the
                // cameras stand outside the footprint, on the open side) and three plain ceiling panels.
                new("Ceiling", Box(0f, 3.075f, 1.675f, FloorHalfExtent * 2f, 0.15f, 2.15f), SceneryMaterial.Ceiling),
                new("CeilingPanel", Box(-5f, 2.965f, 1.675f, 1.2f, 0.07f, 0.45f), SceneryMaterial.Marking),
                new("CeilingPanel", Box(0f, 2.965f, 1.675f, 1.2f, 0.07f, 0.45f), SceneryMaterial.Marking),
                new("CeilingPanel", Box(5f, 2.965f, 1.675f, 1.2f, 0.07f, 0.45f), SceneryMaterial.Marking),

                // Far wall: cornice under the ceiling and a low baseboard, so the wall reads as a wall with a top and a foot.
                new("Cornice", Box(0f, 2.9f, CorridorFarWallInnerZ - 0.04f, 15.7f, 0.2f, 0.08f), SceneryMaterial.Recess),
                new("Baseboard", Box(0f, 0.08f, CorridorFarWallInnerZ - 0.04f, 15.7f, 0.16f, 0.08f), SceneryMaterial.Prop),

                // End walls: baseboard, and one doorway at the west end as the far-end depth cue.
                new("Baseboard", Box(-(CorridorEndInnerX - 0.04f), 0.08f, 0f, 0.08f, 0.16f, 4.9f), SceneryMaterial.Prop),
                new("Baseboard", Box(CorridorEndInnerX - 0.04f, 0.08f, 0f, 0.08f, 0.16f, 4.9f), SceneryMaterial.Prop),
                new("EndDoorFrame", Box(-(CorridorEndInnerX - 0.025f), 1.125f, 0f, 0.05f, 2.25f, 1.4f), SceneryMaterial.Prop),
                new("EndDoor", Box(-(CorridorEndInnerX - 0.065f), 1.05f, 0f, 0.08f, 2.1f, 1.1f), SceneryMaterial.Recess),

                // Floor guide lines along the corridor's length: the strongest single perspective cue, kept off the
                // action line (z = 0) so the floor under the beat stays plain.
                new("FloorLine", Box(0f, 0.006f, 1.85f, 15.6f, 0.012f, 0.1f), SceneryMaterial.Marking, occluder: false),
                new("FloorLine", Box(0f, 0.006f, -1.85f, 15.6f, 0.012f, 0.1f), SceneryMaterial.Marking, occluder: false),
            };

            // Three generic doorways on the far wall, kept away from the region directly behind the staged beats
            // (the fixed cameras look toward -x/+z, so that region stays quiet).
            foreach (var x in new[] { -6.6f, 4.2f, 7.0f })
            {
                p.Add(new SceneryPiece("DoorFrame", Box(x, 1.125f, CorridorFarWallInnerZ - 0.025f, 1.3f, 2.25f, 0.05f), SceneryMaterial.Prop));
                p.Add(new SceneryPiece("Door", Box(x, 1.05f, CorridorFarWallInnerZ - 0.065f, 1.0f, 2.1f, 0.08f), SceneryMaterial.Recess));
            }
            return p;
        }

        // ---- U5.7 iteration 2: shop ----

        // A generic retail interior from a few large forms: two shelving runs (wall run on the west wall, wall run on the far
        // wall), a checkout-counter mass, an entrance opening, a header band and one aisle floor band. Shelves are frame plus
        // horizontal planes over an empty volume: no products, labels, register, sign or brand. Every run and the counter stand
        // at z >= 0.8 (the action slots stay within z <= 1.2 and the cameras look toward +z), and the plain far-wall gap
        // x -5.8..-3.2 is left empty because it is what the fixed cameras see directly behind the beat.
        private static List<SceneryPiece> Shop()
        {
            var p = new List<SceneryPiece>();

            // West wall run: back panel + three shelf planes + two end uprights, z 0.8..7.4.
            const float westZ0 = 0.8f, westZ1 = 7.4f;
            var westLen = westZ1 - westZ0;
            var westCz = (westZ0 + westZ1) / 2f;
            p.Add(new SceneryPiece("ShelfBack", Box(-7.79f, 1.1f, westCz, 0.12f, 2.2f, westLen), SceneryMaterial.Recess));
            foreach (var y in new[] { 0.6f, 1.2f, 1.8f }) p.Add(new SceneryPiece("ShelfPlane", Box(-7.48f, y, westCz, 0.5f, 0.06f, westLen), SceneryMaterial.Prop));
            p.Add(new SceneryPiece("ShelfUpright", Box(-7.48f, 1.1f, westZ0, 0.5f, 2.2f, 0.08f), SceneryMaterial.Recess));
            p.Add(new SceneryPiece("ShelfUpright", Box(-7.48f, 1.1f, westZ1, 0.5f, 2.2f, 0.08f), SceneryMaterial.Recess));

            // Far wall run, right of the plain backdrop gap: x -2.4..2.6.
            const float farX0 = -2.4f, farX1 = 2.6f;
            var farLen = farX1 - farX0;
            var farCx = (farX0 + farX1) / 2f;
            p.Add(new SceneryPiece("ShelfBack", Box(farCx, 1.1f, 7.79f, farLen, 2.2f, 0.12f), SceneryMaterial.Recess));
            foreach (var y in new[] { 0.6f, 1.2f, 1.8f }) p.Add(new SceneryPiece("ShelfPlane", Box(farCx, y, 7.48f, farLen, 0.06f, 0.5f), SceneryMaterial.Prop));
            p.Add(new SceneryPiece("ShelfUpright", Box(farX0, 1.1f, 7.48f, 0.08f, 2.2f, 0.5f), SceneryMaterial.Recess));
            p.Add(new SceneryPiece("ShelfUpright", Box(farX1, 1.1f, 7.48f, 0.08f, 2.2f, 0.5f), SceneryMaterial.Recess));

            // Checkout-counter mass, rear right, well behind and off to the side of every slot.
            p.Add(new SceneryPiece("CounterBody", Box(3.2f, 0.5f, 4.6f, 2.4f, 1.0f, 0.6f), SceneryMaterial.Recess));
            p.Add(new SceneryPiece("CounterTop", Box(3.2f, 1.04f, 4.6f, 2.6f, 0.08f, 0.75f), SceneryMaterial.Prop));

            // Entrance opening in the west wall near the front (the entrance slot side), same doorway language as the corridor.
            p.Add(new SceneryPiece("EntranceFrame", Box(-7.825f, 1.125f, -2.4f, 0.05f, 2.25f, 1.4f), SceneryMaterial.Prop));
            p.Add(new SceneryPiece("Entrance", Box(-7.785f, 1.05f, -2.4f, 0.08f, 2.1f, 1.1f), SceneryMaterial.Recess));

            // Header band along the top of the far and west walls, above the shelving.
            p.Add(new SceneryPiece("Header", Box(0f, 2.85f, 7.81f, 15.7f, 0.25f, 0.08f), SceneryMaterial.Recess));
            p.Add(new SceneryPiece("Header", Box(-7.81f, 2.85f, 0f, 0.08f, 0.25f, 15.7f), SceneryMaterial.Recess));

            // One aisle band on the floor behind the beat, leading into depth.
            p.Add(new SceneryPiece("AisleBand", Box(-4.6f, 0.006f, 4.1f, 1.4f, 0.012f, 6.4f), SceneryMaterial.Recess, occluder: false));
            return p;
        }

        // ---- U5.7 iteration 2: street ----

        // A generic outdoor public space. The floor is the sidewalk; a darker road band and a low curb lie on the camera side
        // of the action (z <= -2.5, 1.9 m or more from every slot, and nothing is ever staged on the road); a layered row of
        // building masses of varied width and height stands along the far side; the sky stays open. No vehicles, signage,
        // windows with readable content, numbers or brands. The boundary walls are unchanged.
        private static List<SceneryPiece> Street()
        {
            var p = new List<SceneryPiece>
            {
                new("Road", Box(0f, 0.004f, -5.25f, 15.6f, 0.008f, 5.5f), SceneryMaterial.Recess, occluder: false),
                new("Curb", Box(0f, 0.06f, -2.5f, 15.6f, 0.12f, 0.24f), SceneryMaterial.Prop),
            };

            // (xMin, xMax, height): the plain mass in x -6.2..-2.6 is what the fixed cameras see directly behind the beat.
            var buildings = new[]
            {
                (xMin: -8.0f, xMax: -6.2f, h: 5.4f),
                (xMin: -6.2f, xMax: -2.6f, h: 3.9f),
                (xMin: -2.6f, xMax: 1.6f, h: 6.0f),
                (xMin: 1.6f, xMax: 5.0f, h: 4.5f),
                (xMin: 5.0f, xMax: 8.0f, h: 5.8f),
            };
            foreach (var b in buildings)
            {
                p.Add(new SceneryPiece("Building", Box((b.xMin + b.xMax) / 2f, b.h / 2f, 7.15f, b.xMax - b.xMin, b.h, 1.5f), SceneryMaterial.Prop));
            }

            // Generic openings: blank dark masses on the facades, away from the plain backdrop mass.
            const float faceZ = 6.37f;
            p.Add(new SceneryPiece("Opening", Box(-7.1f, 3.2f, faceZ, 0.8f, 1.2f, 0.06f), SceneryMaterial.Recess));
            p.Add(new SceneryPiece("Opening", Box(-0.9f, 1.05f, faceZ, 1.0f, 2.1f, 0.06f), SceneryMaterial.Recess));
            p.Add(new SceneryPiece("Opening", Box(-1.6f, 3.6f, faceZ, 0.9f, 1.2f, 0.06f), SceneryMaterial.Recess));
            p.Add(new SceneryPiece("Opening", Box(0.2f, 3.6f, faceZ, 0.9f, 1.2f, 0.06f), SceneryMaterial.Recess));
            p.Add(new SceneryPiece("Opening", Box(3.3f, 1.05f, faceZ, 1.0f, 2.1f, 0.06f), SceneryMaterial.Recess));
            p.Add(new SceneryPiece("Opening", Box(2.6f, 3.0f, faceZ, 0.8f, 1.1f, 0.06f), SceneryMaterial.Recess));
            p.Add(new SceneryPiece("Opening", Box(4.0f, 3.0f, faceZ, 0.8f, 1.1f, 0.06f), SceneryMaterial.Recess));
            p.Add(new SceneryPiece("Opening", Box(6.5f, 3.4f, faceZ, 0.9f, 1.2f, 0.06f), SceneryMaterial.Recess));
            return p;
        }
        private static List<SceneryPiece> Parking()
        {
            var p = new List<SceneryPiece>
            {
                // Low ceiling slab sealing the structure (walls are 3.6 m), with three transverse beams.
                new("Ceiling", Box(0f, ParkingWallHeight + 0.075f, 3.575f, FloorHalfExtent * 2f + 0.3f, 0.15f, 9.15f), SceneryMaterial.Ceiling),
                new("Beam", Box(0f, 3.45f, 0.5f, FloorHalfExtent * 2f, 0.3f, 0.35f), SceneryMaterial.Recess),
                new("Beam", Box(0f, 3.45f, 4.0f, FloorHalfExtent * 2f, 0.3f, 0.35f), SceneryMaterial.Recess),
                new("Beam", Box(0f, 3.45f, 7.3f, FloorHalfExtent * 2f, 0.3f, 0.35f), SceneryMaterial.Recess),

                // Painted band around the foot of the walls: the two-tone wall every garage has.
                new("WallBand", Box(0f, 0.55f, FloorHalfExtent - 0.18f, FloorHalfExtent * 2f - 0.4f, 1.1f, 0.06f), SceneryMaterial.Recess),
                new("WallBand", Box(0f, 0.55f, -(FloorHalfExtent - 0.18f), FloorHalfExtent * 2f - 0.4f, 1.1f, 0.06f), SceneryMaterial.Recess),
                new("WallBand", Box(-(FloorHalfExtent - 0.18f), 0.55f, 0f, 0.06f, 1.1f, FloorHalfExtent * 2f - 0.4f), SceneryMaterial.Recess),
                new("WallBand", Box(FloorHalfExtent - 0.18f, 0.55f, 0f, 0.06f, 1.1f, FloorHalfExtent * 2f - 0.4f), SceneryMaterial.Recess),

                // Stall front line, on the back row well behind every slot (slots stay within z <= 2).
                new("BayLine", Box(0f, 0.006f, 3.9f, 15.4f, 0.012f, 0.1f), SceneryMaterial.Marking, occluder: false),
            };

            // Bay separators on the back row only (z 3.9..7.6): the row of stalls reads as parking without putting any
            // marking under or beside the beat.
            foreach (var x in new[] { -7.2f, -4.8f, -2.4f, 0f, 2.4f, 4.8f, 7.2f })
            {
                p.Add(new SceneryPiece("BayLine", Box(x, 0.006f, 5.75f, 0.1f, 0.012f, 3.7f), SceneryMaterial.Marking, occluder: false));
            }
            return p;
        }
    }
}




