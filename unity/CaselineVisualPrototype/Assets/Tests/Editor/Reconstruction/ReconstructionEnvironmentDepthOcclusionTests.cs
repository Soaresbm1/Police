using System.Collections.Generic;
using System.Linq;
using Caseline.Reconstruction;
using NUnit.Framework;
using UnityEngine;

namespace Caseline.Reconstruction.Tests
{
    /// <summary>
    /// U5.6 iteration 1, item 8 — after adding new environment depth-cue geometry
    /// (<see cref="ReconstructionEnvironmentController.PropBounds"/>), verify none of it sits between any fixed
    /// action camera and the principal actor position it aims at, for every environment/mode/role combination.
    /// Reuses the exact same deterministic geometric technique (no screenshots, no colliders) the U5.2.1 visual QA
    /// pass already validated via <see cref="ReconstructionFramingMeasurement.OccludedSampleCount"/>.
    /// </summary>
    public class ReconstructionEnvironmentDepthOcclusionTests
    {
        private static readonly ReconstructionCameraMode[] ActionModes =
        {
            ReconstructionCameraMode.Interaction,
            ReconstructionCameraMode.PhysicalAttack,
            ReconstructionCameraMode.Discovery,
        };

        // Every slot two actors can share (see ReconstructionZoneLayout.LateralOffsetByRole) — "crime_point" and
        // "interaction" are the two slots any of the three action modes above ever aims at.
        private static readonly string[] ActionSlots = { "interaction", "crime_point" };
        private static readonly string[] Roles = { "culprit", "victim", "accomplice", "unnamed" };

        [Test]
        public void NewDepthCues_NeverOccludeAnyActionCameraShot_AcrossEveryEnvironmentModeAndRole()
        {
            foreach (var environment in ReconstructionSchema.EnvironmentKinds)
            {
                var occluders = ReconstructionEnvironmentController.OccluderBounds(environment);
                foreach (var mode in ActionModes)
                {
                    var framing = ReconstructionCameraPresets.FramingFor(environment, mode);
                    foreach (var slot in ActionSlots)
                    {
                        var shot = ReconstructionCameraPresets.Shot(environment, mode, slot);
                        foreach (var role in Roles)
                        {
                            var actorPos = ReconstructionZoneLayout.GetActorZonePosition(environment, slot, role);
                            var occluded = ReconstructionFramingMeasurement.OccludedSampleCount(shot.Position, actorPos, occluders);
                            Assert.AreEqual(
                                0,
                                occluded,
                                $"{environment}/{mode}/{slot}/{role}: new depth-cue geometry must not occlude the principal action (aim height {framing.AimHeight}m)");
                        }
                    }
                }
            }
        }

        [Test]
        public void ParkingKeepsTheTwoU55PillarsExactlyWhereTheyWere_AndTheyStayOnTheBackRow()
        {
            // U5.5 moved the pillars to the back row so none can hide a person or stand beside a lens. U5.7 adds parking
            // architecture around them but must never move them back toward the action.
            var pillars = ReconstructionEnvironmentController.OccluderBounds("parking")
                .Where(b => Mathf.Approximately(b.size.x, 0.4f) && Mathf.Approximately(b.size.z, 0.4f) && Mathf.Approximately(b.size.y, 3f))
                .ToList();
            Assert.AreEqual(2, pillars.Count, "exactly the two U5.5 pillars");
            Assert.IsTrue(pillars.Any(p => p.center == new Vector3(-4.5f, 1.5f, 5f)));
            Assert.IsTrue(pillars.Any(p => p.center == new Vector3(4.5f, 1.5f, 5f)));
        }
    }
}
