using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using NUnit.Framework;
using UnityEngine;

namespace Caseline.Reconstruction.Tests
{
    /// <summary>
    /// U5.7 iteration 1 — corridor and parking architecture. Structural cues, quiet action zone, camera clearance,
    /// occlusion (every fixed camera INCLUDING the overview), determinism, material reuse and truth-safe inputs. These
    /// prove the geometry rules; whether it reads as a corridor / a parking garage is a human visual judgement made on
    /// the Editor QA stills, never claimed from these tests.
    /// </summary>
    public class ReconstructionEnvironmentStructureTests
    {
        private static readonly string[] Roles = { "culprit", "victim", "accomplice", "unnamed" };
        private const float OverheadFloorY = 2.9f;

        private static IEnumerable<Bounds> NamedBounds(string env, string name) =>
            ReconstructionEnvironmentStructure.Pieces(env).Where(p => p.Name == name).Select(p => p.Bounds);

        // ---- structural cues ----

        [Test]
        public void Corridor_IsANarrowCutAway_FarWallCloseBehindTheAction_NoNearWall_EndWallsAndDoorways()
        {
            var walls = ReconstructionEnvironmentStructure.Walls("corridor");
            Assert.AreEqual(3, walls.Count, "far wall + two end walls; the camera side stays open (cut-away)");
            var farWall = walls.Single(w => w.size.x > 15f);
            Assert.Less(farWall.center.z, 3.5f, "the far wall stands within 3.5 m of the action line so the space reads as narrow");
            Assert.Greater(farWall.center.z, 1.5f);
            Assert.IsFalse(walls.Any(w => w.center.z < -1f), "no wall between the fixed cameras and the action");

            Assert.GreaterOrEqual(NamedBounds("corridor", "Door").Count(), 3, "repeated doorway rhythm on the far wall");
            Assert.GreaterOrEqual(NamedBounds("corridor", "EndDoor").Count(), 1, "a doorway at the far end for depth");
            Assert.GreaterOrEqual(NamedBounds("corridor", "Ceiling").Count(), 1);
            Assert.GreaterOrEqual(NamedBounds("corridor", "FloorLine").Count(), 2, "guide lines along the corridor's length");
            Assert.LessOrEqual(ReconstructionEnvironmentStructure.FloorSize("corridor").y, 6f, "a corridor-width floor, not the 16 m square");
        }

        [Test]
        public void Parking_HasCeilingBeamsBaysAndWallBand_AndKeepsItsWallsAsOneClosedStructure()
        {
            Assert.GreaterOrEqual(NamedBounds("parking", "Ceiling").Count(), 1);
            Assert.GreaterOrEqual(NamedBounds("parking", "Beam").Count(), 3, "repeated beam rhythm");
            Assert.GreaterOrEqual(NamedBounds("parking", "BayLine").Count(), 8, "a back row of painted stalls");
            Assert.AreEqual(4, NamedBounds("parking", "WallBand").Count(), "two-tone wall on all four walls");
            Assert.AreEqual(4, ReconstructionEnvironmentStructure.Walls("parking").Count);
            var beams = NamedBounds("parking", "Beam").ToList();
            Assert.IsTrue(beams.All(b => b.max.y <= ReconstructionEnvironmentStructure.Walls("parking")[0].max.y + 0.01f), "beams sit under the roof line");
        }

        [Test]
        public void Generic_IsNeutralArchitectureOnly_NeverSpecializedIntoAHouseShopOfficeOrCorridor()
        {
            var allowed = new HashSet<string> { "Header", "Pilaster", "DoorFrame", "Opening", "FloorJoint" };
            var pieces = ReconstructionEnvironmentStructure.Pieces("generic");
            Assert.IsTrue(pieces.All(p => allowed.Contains(p.Name)), "generic gets only structure every building has: no shelving, counter, ceiling, guide lines, furniture");
            Assert.LessOrEqual(pieces.Count, 14);
            Assert.GreaterOrEqual(pieces.Count(p => p.Name == "Pilaster"), 3);
            Assert.AreEqual(1, pieces.Count(p => p.Name == "Opening"));
            Assert.GreaterOrEqual(pieces.Count(p => p.Name == "FloorJoint"), 3);
            Assert.IsFalse(pieces.Any(p => p.Bounds.min.y >= OverheadFloorY), "no ceiling");
            Assert.AreEqual(4, ReconstructionEnvironmentStructure.Walls("generic").Count);
            Assert.IsTrue(ReconstructionEnvironmentStructure.UsesStandardTrim("generic"));
            Assert.AreEqual(new Vector2(16f, 16f), ReconstructionEnvironmentStructure.FloorSize("generic"));
        }

        [Test]
        public void Generic_KeepsThePlainBackdropBehindTheBeat_AndAnUnknownKindFallsBackToGeneric()
        {
            foreach (var piece in ReconstructionEnvironmentStructure.Pieces("generic"))
            {
                if (piece.Name == "Header" || piece.Bounds.center.z < 6.5f) continue;
                Assert.IsFalse(piece.Bounds.max.x > -5.8f && piece.Bounds.min.x < -3.2f, $"generic/{piece.Name} intrudes on the plain backdrop behind the beat");
            }
            CollectionAssert.AreEqual(ReconstructionEnvironmentStructure.Pieces("generic").Select(p => p.Bounds), ReconstructionEnvironmentStructure.Pieces("not-a-kind").Select(p => p.Bounds));
        }

        [Test]
        public void EnvironmentPalette_UsesOnlyTheFiveDeclaredColours_AllDistinct_AndEveryGroupIsUsedSomewhere()
        {
            var groups = System.Enum.GetValues(typeof(SceneryMaterial)).Cast<SceneryMaterial>().ToList();
            var colours = groups.Select(ReconstructionEnvironmentPalette.ColorOf).ToList();
            Assert.AreEqual(colours.Count, colours.Distinct().Count(), "no two groups may be visually identical duplicates");
            var used = ReconstructionSchema.EnvironmentKinds.SelectMany(ReconstructionEnvironmentStructure.Pieces).Select(p => p.Material).Distinct().ToList();
            foreach (var group in groups.Where(g => g != SceneryMaterial.Wall)) Assert.Contains(group, used, $"{group} is declared but no environment uses it");
        }
        [Test]
        public void Shop_HasShelvingRunsCounterEntranceHeaderAndAisle_NoProducts()
        {
            Assert.AreEqual(4, ReconstructionEnvironmentStructure.Walls("shop").Count);
            Assert.AreEqual(2, NamedBounds("shop", "ShelfBack").Count(), "two shelving runs (west wall, far wall)");
            Assert.AreEqual(6, NamedBounds("shop", "ShelfPlane").Count(), "three horizontal planes per run, over empty volume");
            Assert.AreEqual(4, NamedBounds("shop", "ShelfUpright").Count());
            Assert.AreEqual(1, NamedBounds("shop", "CounterBody").Count());
            Assert.AreEqual(1, NamedBounds("shop", "CounterTop").Count());
            Assert.AreEqual(1, NamedBounds("shop", "Entrance").Count(), "a generic entrance opening");
            Assert.GreaterOrEqual(NamedBounds("shop", "Header").Count(), 2);
            Assert.GreaterOrEqual(NamedBounds("shop", "AisleBand").Count(), 1);
            Assert.LessOrEqual(ReconstructionEnvironmentStructure.Pieces("shop").Count, 25, "a few strong forms, not dozens of pieces");

            // The counter is a plain mass: nothing small sits on it (no register/computer/receipt/product).
            var counter = NamedBounds("shop", "CounterBody").Single();
            Assert.IsFalse(ReconstructionEnvironmentStructure.Pieces("shop").Any(p => p.Name != "CounterBody" && p.Name != "CounterTop" && p.Bounds.min.y > 1.0f && p.Bounds.max.y < 1.6f && Mathf.Abs(p.Bounds.center.x - counter.center.x) < 1.5f && Mathf.Abs(p.Bounds.center.z - counter.center.z) < 1f));
        }

        [Test]
        public void Shop_PlainBackdropGapStaysEmpty_WhatTheFixedCamerasSeeDirectlyBehindTheBeat()
        {
            foreach (var piece in ReconstructionEnvironmentStructure.Pieces("shop"))
            {
                if (piece.Name == "Header") continue; // a thin band along the very top of the wall, above eye level
                if (piece.Bounds.min.y >= OverheadFloorY) continue;
                var overlapsGapOnFarWall = piece.Bounds.center.z > 6.5f && piece.Bounds.max.x > -5.8f && piece.Bounds.min.x < -3.2f;
                Assert.IsFalse(overlapsGapOnFarWall, $"shop/{piece.Name} intrudes on the plain far-wall backdrop behind the beat");
            }
        }

        [Test]
        public void Street_HasRoadCurbAndLayeredBuildingMasses_OpenSky_NoVehiclesOrCeiling()
        {
            Assert.AreEqual(4, ReconstructionEnvironmentStructure.Walls("street").Count, "boundary walls unchanged (never moved to hide the entrance-offset issue)");
            Assert.IsFalse(ReconstructionEnvironmentStructure.UsesStandardTrim("street"));
            Assert.AreEqual(1, NamedBounds("street", "Road").Count());
            Assert.AreEqual(1, NamedBounds("street", "Curb").Count());
            var buildings = NamedBounds("street", "Building").ToList();
            Assert.GreaterOrEqual(buildings.Count, 5);
            Assert.GreaterOrEqual(buildings.Select(b => Mathf.Round(b.size.y * 10f)).Distinct().Count(), 4, "varied heights");
            Assert.GreaterOrEqual(buildings.Select(b => Mathf.Round(b.size.x * 10f)).Distinct().Count(), 3, "varied widths");
            Assert.IsFalse(ReconstructionEnvironmentStructure.Pieces("street").Any(p => p.Name == "Ceiling"), "the sky stays open");
            Assert.IsTrue(ReconstructionEnvironmentStructure.Pieces("street").Where(p => p.Occluder).All(p => p.Bounds.center.z < -2f || p.Bounds.min.z > 6f), "street architecture is either the low curb on the camera side or the far building row");
        }

        [Test]
        public void StreetRoadAndCurb_SitOnTheCameraSideOfEverySlot_SoNobodyIsEverStagedOnTheRoad()
        {
            var road = NamedBounds("street", "Road").Single();
            var curb = NamedBounds("street", "Curb").Single();
            Assert.LessOrEqual(curb.max.y, 0.15f, "a subtle curb: no step or stair implication");
            foreach (var slot in ReconstructionSchema.Slots)
            {
                var pos = ReconstructionZoneLayout.GetZonePosition("street", slot);
                Assert.Greater(pos.z, road.max.z, $"street slot {slot} stays on the sidewalk, not the road");
                Assert.Greater(pos.z - 0.6f, curb.max.z, $"street slot {slot} stays clear of the curb");
            }
        }

        // ---- quiet action zone / ground contact ----

        [Test]
        public void ActionZonesStayQuiet_NoArchitectureNearAnySlotAtFloorOrBodyHeight_AndNothingRaisesTheFloor()
        {
            foreach (var env in ReconstructionSchema.EnvironmentKinds)
            {
                foreach (var slot in new[] { "interaction", "crime_point", "interior_center" })
                {
                    var slotPos = ReconstructionZoneLayout.GetZonePosition(env, slot);
                    foreach (var piece in ReconstructionEnvironmentStructure.Pieces(env))
                    {
                        if (piece.Bounds.min.y >= OverheadFloorY) continue; // overhead structure is above the beat, not under or behind it
                        if (piece.Bounds.max.y <= 0f) continue; // the stage plate sits below the floor plane, not on it
                        var footprint = new Bounds(new Vector3(piece.Bounds.center.x, 0f, piece.Bounds.center.z), new Vector3(piece.Bounds.size.x, 1f, piece.Bounds.size.z));
                        var dist = Mathf.Sqrt(footprint.SqrDistance(new Vector3(slotPos.x, 0f, slotPos.z)));
                        Assert.GreaterOrEqual(dist, 1.6f, $"{env}/{piece.Name} sits {dist:F2} m from the {slot} slot: the beat's own area must stay quiet");
                    }
                }

                // Actors stand on y = 0: nothing may straddle the floor plane where a person could stand.
                Assert.IsTrue(ReconstructionEnvironmentStructure.Pieces(env).All(p => p.Bounds.min.y >= -0.05f), $"{env}: no piece sinks below the floor plane");
            }
        }

        // ---- camera clearance and occlusion ----

        private static IEnumerable<ReconstructionCameraShot> AllShots(string env)
        {
            foreach (var mode in new[] { ReconstructionCameraMode.Interaction, ReconstructionCameraMode.PhysicalAttack, ReconstructionCameraMode.Discovery })
            {
                foreach (var slot in new[] { "interaction", "crime_point", "interior_center" })
                {
                    yield return ReconstructionCameraPresets.Shot(env, mode, slot);
                }
            }
            yield return ReconstructionCameraPresets.Overview();
        }

        [Test]
        public void EnvironmentNearPlaneSafety_NothingBesideTheLens_AndOverheadStructureKeepsHeadroom()
        {
            foreach (var env in ReconstructionSchema.EnvironmentKinds)
            {
                var occluders = ReconstructionEnvironmentController.OccluderBounds(env).Skip(ReconstructionEnvironmentController.WallCount(env)).ToList();
                foreach (var shot in AllShots(env).Where(s => s.Mode != ReconstructionCameraMode.Overview))
                {
                    foreach (var box in occluders)
                    {
                        if (box.min.y >= OverheadFloorY)
                        {
                            var footprint = new Bounds(new Vector3(box.center.x, shot.Position.y, box.center.z), new Vector3(box.size.x + 1f, 1f, box.size.z + 1f));
                            if (footprint.Contains(new Vector3(shot.Position.x, shot.Position.y, shot.Position.z)))
                            {
                                Assert.GreaterOrEqual(box.min.y - shot.Position.y, 0.6f, $"{env}/{shot.Mode}: overhead structure directly above the lens needs headroom");
                            }
                            continue;
                        }
                        Assert.Greater(Mathf.Sqrt(box.SqrDistance(shot.Position)), 1.5f, $"{env}/{shot.Mode}: a piece right beside the lens would fill the frame's edge");
                    }
                }
            }
        }

        [Test]
        public void NoStructureOccludesAnyone_FromAnyFixedCamera_IncludingTheOverview()
        {
            foreach (var env in ReconstructionSchema.EnvironmentKinds)
            {
                var occluders = ReconstructionEnvironmentController.OccluderBounds(env);
                foreach (var shot in AllShots(env))
                {
                    foreach (var slot in ReconstructionSchema.Slots)
                    {
                        // Entrance/exit are walking-in/out slots whose lateral offsets already place a third person outside the boundary
                        // wall in some environments (pre-existing, e.g. street entrance x = -8.35); the semantic action slots are what a
                        // beat is staged at, and every one of them is checked against every camera, the overview included.
                        var relevantSlot = slot == "interaction" || slot == "crime_point" || slot == "interior_center";
                        if (!relevantSlot) continue;
                        foreach (var role in Roles)
                        {
                            var actorPos = ReconstructionZoneLayout.GetActorZonePosition(env, slot, role);
                            var occluded = ReconstructionFramingMeasurement.OccludedSampleCount(shot.Position, actorPos, occluders);
                            Assert.AreEqual(0, occluded, $"{env}/{shot.Mode}/{slot}/{role}");
                        }
                    }
                }
            }
        }

        // ---- determinism, materials, truth-safety ----

        [Test]
        public void Structure_IsDeterministic_SameKindSameGeometry()
        {
            foreach (var env in ReconstructionSchema.EnvironmentKinds)
            {
                var a = ReconstructionEnvironmentStructure.Pieces(env);
                var b = ReconstructionEnvironmentStructure.Pieces(env);
                Assert.AreEqual(a.Count, b.Count, env);
                for (var i = 0; i < a.Count; i++)
                {
                    Assert.AreEqual(a[i].Name, b[i].Name);
                    Assert.AreEqual(a[i].Bounds, b[i].Bounds);
                    Assert.AreEqual(a[i].Material, b[i].Material);
                }
                CollectionAssert.AreEqual(ReconstructionEnvironmentStructure.Walls(env), ReconstructionEnvironmentStructure.Walls(env));
            }
        }

        [Test]
        public void MaterialGroups_AreFewAndShared_AndBudgetIsReported()
        {
            var shader = Shader.Find("Standard");
            Assert.IsNotNull(shader);
            var floor = new Material(shader);
            var wall = new Material(shader);
            var prop = new Material(shader);
            var zone = new Material(shader);
            var go = new GameObject("EnvBudgetProbe");
            try
            {
                var controller = go.AddComponent<ReconstructionEnvironmentController>();
                foreach (var env in ReconstructionSchema.EnvironmentKinds)
                {
                    controller.Build(env, floor, wall, prop, zone);
                    var renderers = go.GetComponentsInChildren<MeshRenderer>();
                    var tris = go.GetComponentsInChildren<MeshFilter>().Sum(f => f.sharedMesh.triangles.Length / 3);
                    var materials = renderers.Select(r => r.sharedMaterial).Distinct().Count();
                    Debug.Log($"[U5.7 budget] {env}: renderers={renderers.Length} tris={tris} materials={materials}");
                    Assert.LessOrEqual(materials, 8, $"{env}: a handful of shared material groups, never one per object");
                    Assert.LessOrEqual(renderers.Length, 40, $"{env}: architecture, not clutter");
                }
            }
            finally
            {
                Object.DestroyImmediate(go);
                Object.DestroyImmediate(floor);
                Object.DestroyImmediate(wall);
                Object.DestroyImmediate(prop);
                Object.DestroyImmediate(zone);
            }
        }

        [Test]
        public void EnvironmentStructure_TakesOnlyTheSafeEnvironmentKind_NoSeedCasePersonOrEvidenceInput()
        {
            foreach (var method in typeof(ReconstructionEnvironmentStructure).GetMethods(BindingFlags.Public | BindingFlags.Static).Where(m => m.DeclaringType == typeof(ReconstructionEnvironmentStructure)))
            {
                var parameters = method.GetParameters();
                Assert.IsTrue(parameters.All(p => p.ParameterType == typeof(string) && p.Name == "environment"), $"{method.Name} must take only the environment kind");
            }
        }

        [Test]
        public void EveryPieceIsGenericArchitecture_NothingThatCouldReadAsEvidenceOrAFactualDetail()
        {
            var allowed = new HashSet<string>
            {
                "Ground", "Ceiling", "CeilingPanel", "Cornice", "Baseboard", "EndDoorFrame", "EndDoor", "FloorLine", "DoorFrame", "Door",
                "Beam", "WallBand", "BayLine",
                "ShelfBack", "ShelfPlane", "ShelfUpright", "CounterBody", "CounterTop", "EntranceFrame", "Entrance", "Header", "AisleBand",
                "Road", "Curb", "Building", "Opening", "Pilaster", "FloorJoint",
            };
            foreach (var env in ReconstructionSchema.EnvironmentKinds)
            {
                foreach (var piece in ReconstructionEnvironmentStructure.Pieces(env))
                {
                    Assert.IsTrue(allowed.Contains(piece.Name), $"{env}/{piece.Name}: not in the generic-architecture vocabulary (no weapon, blood, bottle, syringe, pills, rope, document, phone, bag, vehicle, plate, evidence marker or camera)");
                }
            }
        }

        [Test]
        public void ActorContrastIsPreserved_TheDefaultMannequinStillStandsOutFromEverySurfaceItStandsOrAppearsAgainst()
        {
            float L(Color c) => ReconstructionEnvironmentPalette.Luminance(c);
            var neutralTorso = ReconstructionMaterialGroup.BandTint(ReconstructionAppearanceUtil.ToneTint("casual_neutral"), ReconstructionMaterialBand.Torso);
            var neutralLimb = ReconstructionMaterialGroup.BandTint(ReconstructionAppearanceUtil.ToneTint("casual_neutral"), ReconstructionMaterialBand.Limb);
            foreach (var group in new[] { SceneryMaterial.Wall, SceneryMaterial.Prop, SceneryMaterial.Recess, SceneryMaterial.Marking })
            {
                var surface = ReconstructionEnvironmentPalette.ColorOf(group);
                Debug.Log($"[U5.7 contrast] {group}: L={L(surface):F3} vs neutral torso L={L(neutralTorso):F3} limb L={L(neutralLimb):F3}");
                Assert.GreaterOrEqual(Mathf.Abs(L(surface) - L(neutralTorso)), 0.05f, $"{group} must stay visibly apart from the default torso");
            }
            Assert.GreaterOrEqual(L(ReconstructionEnvironmentPalette.Floor) - L(neutralTorso), 0.08f);
        }
    }
}




