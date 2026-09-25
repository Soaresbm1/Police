using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;
using static Caseline.Reconstruction.ReconstructionLabelLayout;

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

        // ==================== walk-path safety (mini-checkpoint items 1-5) ====================

        private static ReconstructionActorData MakeWalker(string visualId, string role, params (float time, string slot)[] waypoints)
        {
            var actor = new ReconstructionActorData
            {
                visualId = visualId,
                roleForReconstruction = role,
                genericAppearance = "casual_neutral",
                spawnTime = 0f,
                despawnTime = 1000f,
                waypoints = new List<ReconstructionWaypointData>(),
            };
            foreach (var (time, slot) in waypoints) actor.waypoints.Add(new ReconstructionWaypointData { time = time, slot = slot });
            return actor;
        }

        private static readonly float[] SampleFractions = { 0f, 0.1f, 0.2f, 0.3f, 0.4f, 0.5f, 0.6f, 0.7f, 0.8f, 0.9f, 1f };

        /// <summary>Every leg that walks into or out of the two affected Street slots, both directions, every role.
        /// Samples the full interpolated path (11 points per leg) and asserts the actor's visual bounds — root x plus
        /// the 0.30 m safety half-width — never leave the wall on either axis, and that the walk's own final sample
        /// matches the idle position `GetActorZonePosition` resolves to (no snap between walking and idle).</summary>
        [TestCase("interior_center", "entrance")]
        [TestCase("entrance", "interior_center")]
        [TestCase("interior_center", "exit")]
        [TestCase("exit", "interior_center")]
        public void WalkPath_IntoAndOutOfAffectedStreetSlots_StaysWithinBounds_ForEveryRole(string fromSlot, string toSlot)
        {
            const float legStart = 0f;
            const float legEnd = 8f; // == MaxWalkSeconds, so the whole leg is a walk
            foreach (var role in Roles)
            {
                var actor = MakeWalker("w", role, (legStart, fromSlot), (legEnd, toSlot));
                var minX = float.MaxValue;
                var maxX = float.MinValue;
                foreach (var f in SampleFractions)
                {
                    var t = Mathf.Lerp(legStart, legEnd, f);
                    var pose = ReconstructionActorTimeline.Evaluate(actor, new List<ReconstructionEventData>(), "street", t);
                    Assert.IsTrue(pose.visible);
                    minX = Mathf.Min(minX, pose.position.x);
                    maxX = Mathf.Max(maxX, pose.position.x);
                    Assert.LessOrEqual(Mathf.Abs(pose.position.x) + ActorHalfWidth, Boundary, $"{fromSlot}->{toSlot}/{role} at f={f}: x={pose.position.x}");
                    Assert.LessOrEqual(Mathf.Abs(pose.position.z) + ActorHalfWidth, Boundary, $"{fromSlot}->{toSlot}/{role} at f={f}: z={pose.position.z}");
                }

                var finalPose = ReconstructionActorTimeline.Evaluate(actor, new List<ReconstructionEventData>(), "street", legEnd + 0.001f);
                var expectedEndpoint = ReconstructionZoneLayout.GetActorZonePosition("street", toSlot, role);
                Assert.AreEqual(expectedEndpoint.x, finalPose.position.x, 0.001f, $"{fromSlot}->{toSlot}/{role}: no snap between the last walking frame and idle");
                Debug.Log($"[staging-fix][walk] street {fromSlot}->{toSlot}/{role}: x range [{minX:F3}, {maxX:F3}]");
            }
        }

        // ==================== actual visual footprint / pair separation (items 6-9) ====================

        // U5.6 mannequin geometry (frozen; see ReconstructionActorVisualPolish, Editor-only, referenced here only in
        // comment form since Tests cannot reference Editor assemblies): TorsoDims top half-width 0.20 m; the upper
        // arm is shoulder-mounted at CCTVPrototypeBuilder's own shoulder offset (0.19 m from the spine) with its own
        // top half-width 0.055 m. The single widest point of a standing actor is therefore the shoulder/upper-arm
        // line, 0.19 + 0.055 = 0.245 m from the root — measured from the actual approved geometry, not guessed.
        private const float ActualVisualHalfWidth = 0.245f;

        [Test]
        public void ActualVisualFootprint_RequiredPairSeparation_ReportedAgainstTheConstrainedRootGap()
        {
            var requiredForNoBoundingOverlap = ActualVisualHalfWidth * 2f;
            var constrainedGap = MinAdjacentGap("street", "entrance");
            Debug.Log($"[staging-fix][footprint] actual half-width={ActualVisualHalfWidth:F3}m, required pair separation={requiredForNoBoundingOverlap:F3}m, constrained adjacent root gap={constrainedGap:F3}m");
            // Documented, not asserted as a failure: see the classification test below for the actual verdict per
            // role pair. A single scalar "required separation" is a conservative worst case (both actors turned
            // shoulder-to-shoulder at the same instant) rather than the typical case.
            Assert.Greater(constrainedGap, 0f);
        }

        private static float MinAdjacentGap(string environment, string slot)
        {
            var xs = Roles.Select(r => ReconstructionZoneLayout.GetActorZonePosition(environment, slot, r).x).OrderBy(x => x).ToList();
            return xs.Zip(xs.Skip(1), (a, b) => b - a).Min();
        }

        private enum Separation { Clear, TouchingTolerance, Overlap }

        private static Separation Classify(float gap)
        {
            var required = ActualVisualHalfWidth * 2f;
            if (gap >= required) return Separation.Clear;
            if (gap >= required - 0.10f) return Separation.TouchingTolerance; // within 10cm of just touching
            return Separation.Overlap;
        }

        [TestCase("culprit", "victim")]
        [TestCase("culprit", "accomplice")]
        [TestCase("victim", "unnamed")]
        [TestCase("accomplice", "unnamed")]
        public void MultiActorMatrix_RealisticTwoRolePairs_AtStreetEntranceAndExit_Classified(string roleA, string roleB)
        {
            foreach (var slot in new[] { "entrance", "exit" })
            {
                var xa = ReconstructionZoneLayout.GetActorZonePosition("street", slot, roleA).x;
                var xb = ReconstructionZoneLayout.GetActorZonePosition("street", slot, roleB).x;
                var gap = Mathf.Abs(xb - xa);
                var verdict = Classify(gap);
                Debug.Log($"[staging-fix][pair] street/{slot} {roleA}+{roleB}: gap={gap:F3}m verdict={verdict}");
                Assert.AreNotEqual(Separation.Overlap, verdict, $"street/{slot} {roleA}+{roleB}: gap={gap:F3}m — material overlap for a realistic two-actor combination");
            }
        }

        [Test]
        public void MultiActorMatrix_AllFourRolesStressCase_AtStreetEntranceAndExit_NoCatastrophicStacking()
        {
            foreach (var slot in new[] { "entrance", "exit" })
            {
                var xs = Roles.Select(r => ReconstructionZoneLayout.GetActorZonePosition("street", slot, r).x).OrderBy(x => x).ToList();
                Assert.AreEqual(4, xs.Distinct().Count(), $"street/{slot}: all four roles must resolve to distinct positions");
                var minGap = xs.Zip(xs.Skip(1), (a, b) => b - a).Min();
                var verdict = Classify(minGap);
                Debug.Log($"[staging-fix][stress] street/{slot} all four roles: min gap={minGap:F3}m verdict={verdict} (presentation-layout stress test only, not a claim any four-actor truth scenario exists)");
                Assert.Greater(minGap, 0.15f, $"street/{slot}: four-role stress case must not collapse into near-identical positions (catastrophic stacking)");
            }
        }

        // ==================== facing under compression (item 10) ====================

        [TestCase("culprit", "victim")]
        [TestCase("accomplice", "unnamed")]
        public void FacingTowardColocatedActor_UnderCompression_GivesANonZeroSensibleDirection(string roleA, string roleB)
        {
            foreach (var slot in new[] { "entrance", "exit" })
            {
                var a = MakeWalker("a", roleA, (0f, slot));
                var b = MakeWalker("b", roleB, (0f, slot));
                var all = new List<ReconstructionActorData> { a, b };
                var poseA = ReconstructionActorTimeline.Evaluate(a, new List<ReconstructionEventData>(), "street", 0f, all);
                var poseB = ReconstructionActorTimeline.Evaluate(b, new List<ReconstructionEventData>(), "street", 0f, all);
                Assert.Greater(poseA.facing.sqrMagnitude, 0.0001f, $"street/{slot} {roleA} facing must not be zero-length");
                Assert.Greater(poseB.facing.sqrMagnitude, 0.0001f, $"street/{slot} {roleB} facing must not be zero-length");
                // Each must face toward the other's actual (constrained) position, not away from it.
                var towardB = Mathf.Sign(poseB.position.x - poseA.position.x);
                var towardA = Mathf.Sign(poseA.position.x - poseB.position.x);
                if (Mathf.Abs(poseB.position.x - poseA.position.x) > 0.01f)
                {
                    Assert.AreEqual(towardB, Mathf.Sign(poseA.facing.x), $"street/{slot} {roleA} should face toward {roleB}, not away");
                    Assert.AreEqual(towardA, Mathf.Sign(poseB.facing.x), $"street/{slot} {roleB} should face toward {roleA}, not away");
                }
            }
        }

        // ==================== label layout, structural (item 11) ====================

        [Test]
        public void LabelLayout_AllFourRoleLabels_PlaceableWithoutOverlap_AtTheConstrainedStreetEntranceStressCase()
        {
            var style = ReconstructionOverlay.CreateLabelStyle(EditorGUIUtility.GetBuiltinSkin(EditorSkin.Game).label);
            var camGo = new GameObject("QaLabelCamera");
            try
            {
                var cam = camGo.AddComponent<Camera>();
                var shot = ReconstructionCameraPresets.Overview();
                cam.transform.SetPositionAndRotation(shot.Position, shot.Rotation);
                cam.fieldOfView = shot.FieldOfView;
                cam.pixelRect = new Rect(0, 0, 960, 600);

                var roleTexts = new Dictionary<string, string> { ["culprit"] = "AUTEUR", ["victim"] = "VICTIME", ["accomplice"] = "COMPLICE", ["unnamed"] = "PERSONNE" };
                var requests = new List<LabelRequest>();
                foreach (var role in Roles)
                {
                    var worldPos = ReconstructionZoneLayout.GetActorZonePosition("street", "entrance", role) + Vector3.up * 1.7f;
                    var screen = cam.WorldToScreenPoint(worldPos);
                    var text = roleTexts[role];
                    requests.Add(new LabelRequest(role, LabelRect(style.CalcSize(new GUIContent(text)), screen.x, 600f - screen.y)));
                }

                var laneStep = LaneStep(requests);
                var placed = Resolve(requests, laneStep);

                Assert.AreEqual(4, placed.Length);
                for (var i = 0; i < placed.Length; i++)
                {
                    for (var j = i + 1; j < placed.Length; j++)
                    {
                        Assert.IsFalse(placed[i].Overlaps(placed[j]), $"{Roles[i]} label overlaps {Roles[j]} label");
                    }
                }
                Debug.Log($"[staging-fix][labels] street/entrance all-four stress case: lanes used = {placed.Select(r => r.y).Distinct().Count()}");
            }
            finally
            {
                Object.DestroyImmediate(camGo);
            }
        }

        // ==================== camera framing re-check (item 12) ====================

        [Test]
        public void CameraFraming_OverviewShot_KeepsConstrainedStreetEntranceActorsFullyInFrame()
        {
            // Entrance/exit are not among the slots any close-up mode (Interaction/PhysicalAttack/Discovery) is ever
            // aimed at (see ReconstructionCameraPresets/ReconstructionActionCameraMatrixTests' own AllSlotShots) —
            // only the single shared Overview shot ever shows them, so that is what this re-verifies.
            var shot = ReconstructionCameraPresets.Overview();
            var camGo = new GameObject("QaFramingCamera");
            try
            {
                var cam = camGo.AddComponent<Camera>();
                cam.transform.SetPositionAndRotation(shot.Position, shot.Rotation);
                cam.fieldOfView = shot.FieldOfView;
                cam.aspect = ReconstructionFramingMeasurement.ViewerAspect;
                foreach (var role in Roles)
                {
                    var pos = ReconstructionZoneLayout.GetActorZonePosition("street", "entrance", role);
                    var result = ReconstructionFramingMeasurement.MeasureActor(cam, pos, Vector3.forward, lying: false, new List<Bounds>());
                    Assert.IsTrue(result.extentsInFrame, $"street/entrance/{role} must stay fully inside the Overview frame");
                }
            }
            finally
            {
                Object.DestroyImmediate(camGo);
            }
        }
    }
}
