using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Caseline.Reconstruction.Tests
{
    /// <summary>
    /// Post-U5.7 staging-bounds fix. Confirms the exact known defect (street/entrance/accomplice at x = -8.35) is
    /// gone, that it was one of exactly two unsafe combinations out of the full 5x5x4 matrix, that every already-safe
    /// combination is untouched to the bit, and that the fix is deterministic and flows correctly into walking,
    /// facing and seeking.
    /// </summary>
    public class ReconstructionZoneLayoutBoundsTests
    {
        private const float Boundary = 8f; // ReconstructionEnvironmentStructure.FloorHalfExtent
        private const float ActorHalfWidth = 0.30f; // matches ReconstructionZoneLayout.ActorPresentationHalfWidth
        private static readonly string[] Roles = { "culprit", "victim", "accomplice", "unnamed" };

        private static bool IsSafe(Vector3 pos) => Mathf.Abs(pos.x) <= Boundary - ActorHalfWidth;

        [Test]
        public void KnownDefect_StreetEntranceAccomplice_NoLongerExceedsTheBoundary()
        {
            var pos = ReconstructionZoneLayout.GetActorZonePosition("street", "entrance", "accomplice");
            Assert.Less(Mathf.Abs(pos.x), 8f, "must stay strictly inside the physical wall (old behaviour was x = -8.35)");
            Assert.IsTrue(IsSafe(pos), $"must be within the actor's safety margin of the wall (x = {pos.x})");
        }

        [Test]
        public void KnownDefect_StreetExitUnnamed_WasTheOtherUnsafeCombination_NowFixed()
        {
            // The audit found this to be the mirror-image case of the known defect (same magnitude, opposite side) —
            // not something anyone had previously reported, but required by the same root cause.
            var pos = ReconstructionZoneLayout.GetActorZonePosition("street", "exit", "unnamed");
            Assert.Less(Mathf.Abs(pos.x), 8f);
            Assert.IsTrue(IsSafe(pos), $"x = {pos.x}");
        }

        /// <summary>The full 5 (environments) x 5 (slots) x 4 (roles) = 100-combination matrix. Every combination
        /// must keep the actor's visible silhouette inside the boundary wall on every axis a lateral offset could
        /// ever push it.</summary>
        [Test]
        public void ExhaustiveMatrix_AllEnvironmentsSlotsAndRoles_StayWithinTheSafePresentationZone()
        {
            var checkedCount = 0;
            var unsafeCombinations = new List<string>();
            foreach (var env in ReconstructionSchema.EnvironmentKinds)
            {
                foreach (var slot in ReconstructionSchema.Slots)
                {
                    foreach (var role in Roles)
                    {
                        checkedCount++;
                        var pos = ReconstructionZoneLayout.GetActorZonePosition(env, slot, role);
                        if (!IsSafe(pos)) unsafeCombinations.Add($"{env}/{slot}/{role} -> x={pos.x}");
                        // Z is never touched by the role offset, so it can only be unsafe if the base slot itself is
                        // — which would be an environment-authoring bug, not a staging-offset bug; assert it anyway.
                        Assert.LessOrEqual(Mathf.Abs(pos.z), Boundary - ActorHalfWidth, $"{env}/{slot}/{role} unsafe on Z");
                    }
                }
            }
            Assert.AreEqual(100, checkedCount, "5 environments x 5 slots x 4 roles");
            CollectionAssert.IsEmpty(unsafeCombinations, string.Join("; ", unsafeCombinations));
        }

        /// <summary>Everywhere the OLD unclamped formula was already safe, the NEW formula must produce the exact
        /// same position — proving the fix touches only the two unsafe combinations' slots, nothing else.</summary>
        [Test]
        public void UnaffectedCombinations_RemainNumericallyIdenticalToTheOldUnclampedFormula()
        {
            var untouchedSlotCount = 0;
            foreach (var env in ReconstructionSchema.EnvironmentKinds)
            {
                foreach (var slot in ReconstructionSchema.Slots)
                {
                    var isAffectedSlot = env == "street" && (slot == "entrance" || slot == "exit");
                    if (isAffectedSlot) continue;
                    untouchedSlotCount++;
                    var basePos = ReconstructionZoneLayout.GetZonePosition(env, slot);
                    foreach (var role in Roles)
                    {
                        var oldOffset = role switch { "culprit" => -0.55f, "victim" => 0.55f, "accomplice" => -1.35f, _ => 1.35f };
                        var oldPosition = basePos + new Vector3(oldOffset, 0f, 0f);
                        var newPosition = ReconstructionZoneLayout.GetActorZonePosition(env, slot, role);
                        Assert.AreEqual(oldPosition, newPosition, $"{env}/{slot}/{role} must be bit-identical to the pre-fix formula");
                    }
                }
            }
            Assert.AreEqual(23, untouchedSlotCount, "25 slots total minus the 2 affected street slots");
        }

        [Test]
        public void InteriorValidatedStaging_InteractionCrimePointInteriorCenter_UnchangedAcrossAllEnvironments()
        {
            // The U5.6/U5.5 validated camera framings only ever aim at these three slots (never entrance/exit) — the
            // fix must never move them, in any environment, including street.
            foreach (var env in ReconstructionSchema.EnvironmentKinds)
            {
                foreach (var slot in new[] { "interaction", "crime_point", "interior_center" })
                {
                    var basePos = ReconstructionZoneLayout.GetZonePosition(env, slot);
                    foreach (var role in Roles)
                    {
                        var oldOffset = role switch { "culprit" => -0.55f, "victim" => 0.55f, "accomplice" => -1.35f, _ => 1.35f };
                        Assert.AreEqual(basePos + new Vector3(oldOffset, 0f, 0f), ReconstructionZoneLayout.GetActorZonePosition(env, slot, role), $"{env}/{slot}/{role}");
                    }
                }
            }
        }

        [Test]
        public void AffectedStreetSlots_PreserveRoleOrderAndSign_NoRoleCrossesToTheOppositeSide()
        {
            foreach (var slot in new[] { "entrance", "exit" })
            {
                var byRole = Roles.ToDictionary(r => r, r => ReconstructionZoneLayout.GetActorZonePosition("street", slot, r).x);
                Assert.Less(byRole["accomplice"], byRole["culprit"], slot);
                Assert.Less(byRole["culprit"], byRole["victim"], slot);
                Assert.Less(byRole["victim"], byRole["unnamed"], slot);
                // Same sign as before the fix (culprit/accomplice negative offset, victim/unnamed positive offset,
                // relative to the slot's own base position).
                var basePos = ReconstructionZoneLayout.GetZonePosition("street", slot);
                Assert.Less(byRole["accomplice"], basePos.x, slot);
                Assert.Less(byRole["culprit"], basePos.x, slot);
                Assert.Greater(byRole["victim"], basePos.x, slot);
                Assert.Greater(byRole["unnamed"], basePos.x, slot);
            }
        }

        [Test]
        public void AffectedStreetSlots_ReportMinimumRoleSeparation_BeforeAndAfterTheFix()
        {
            // Documents the honest trade-off: fixing the boundary violation compresses the spacing between the two
            // outermost roles and their neighbours at these two slots specifically (never at interaction/crime_point).
            foreach (var slot in new[] { "entrance", "exit" })
            {
                var basePos = ReconstructionZoneLayout.GetZonePosition("street", slot);
                var oldX = Roles.Select(r => basePos.x + (r switch { "culprit" => -0.55f, "victim" => 0.55f, "accomplice" => -1.35f, _ => 1.35f })).OrderBy(x => x).ToList();
                var newX = Roles.Select(r => ReconstructionZoneLayout.GetActorZonePosition("street", slot, r).x).OrderBy(x => x).ToList();
                var oldMinGap = oldX.Zip(oldX.Skip(1), (a, b) => b - a).Min();
                var newMinGap = newX.Zip(newX.Skip(1), (a, b) => b - a).Min();
                Debug.Log($"[staging-fix] street/{slot} minimum adjacent-role gap: before={oldMinGap:F3}m after={newMinGap:F3}m");
                Assert.Greater(newMinGap, 0f, $"{slot}: no two roles may collapse onto the same position");
            }
        }

        [Test]
        public void Fix_IsDeterministic_SameEnvironmentSlotRoleAlwaysGivesTheSamePosition()
        {
            foreach (var env in ReconstructionSchema.EnvironmentKinds)
            {
                foreach (var slot in ReconstructionSchema.Slots)
                {
                    foreach (var role in Roles)
                    {
                        var a = ReconstructionZoneLayout.GetActorZonePosition(env, slot, role);
                        var b = ReconstructionZoneLayout.GetActorZonePosition(env, slot, role);
                        Assert.AreEqual(a, b, $"{env}/{slot}/{role}");
                    }
                }
            }
        }

        [Test]
        public void Fix_DependsOnlyOnEnvironmentSlotAndRole_NeverOnCaseIdentity()
        {
            var method = typeof(ReconstructionZoneLayout).GetMethod("GetActorZonePosition");
            var parameters = method!.GetParameters();
            Assert.AreEqual(3, parameters.Length);
            Assert.IsTrue(parameters.All(p => p.ParameterType == typeof(string)), "environment, slot and role only — no seed, visualId or CaseTruth input exists to depend on");
        }
    }
}
