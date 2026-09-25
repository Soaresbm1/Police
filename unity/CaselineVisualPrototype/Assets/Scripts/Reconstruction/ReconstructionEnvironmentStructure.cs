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
        public static bool UsesStandardTrim(string environment) => environment != "corridor";

        public static IReadOnlyList<SceneryPiece> Pieces(string environment)
        {
            switch (environment)
            {
                case "corridor": return Corridor();
                case "parking": return Parking();
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



