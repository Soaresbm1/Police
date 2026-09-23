using System.Collections.Generic;
using Caseline.Reconstruction;
using NUnit.Framework;
using UnityEngine;

namespace Caseline.Reconstruction.Tests
{
    public class ReconstructionActorTimelineTests
    {
        private static ReconstructionActorData MakeActor(string visualId, string role, float spawn, float despawn, params (float time, string slot)[] waypoints)
        {
            var actor = new ReconstructionActorData
            {
                visualId = visualId,
                roleForReconstruction = role,
                genericAppearance = "casual_neutral",
                spawnTime = spawn,
                despawnTime = despawn,
                waypoints = new List<ReconstructionWaypointData>(),
            };
            foreach (var (time, slot) in waypoints)
            {
                actor.waypoints.Add(new ReconstructionWaypointData { time = time, slot = slot });
            }
            return actor;
        }

        private static ReconstructionEventData MakeAttackEvent(float time, string actorId, string counterpartyId, string safeVisualAction = "attack_strike")
        {
            return new ReconstructionEventData
            {
                time = time,
                type = "attack",
                actorVisualId = actorId,
                counterpartyVisualId = counterpartyId,
                locationSlot = "crime_point",
                safeVisualAction = safeVisualAction,
            };
        }

        [Test]
        public void AttackerAndTarget_DuringTheAttackBeat_AreStagedApart_NotMergedIntoOneBody()
        {
            var culprit = MakeActor("c", "culprit", 0, 100, (0, "interaction"), (10, "crime_point"));
            var victim = MakeActor("v", "victim", 0, 100, (0, "interaction"), (10, "crime_point"));
            var events = new List<ReconstructionEventData> { MakeAttackEvent(10f, "c", "v") };

            var attacker = ReconstructionActorTimeline.Evaluate(culprit, events, "generic", 11f);
            var target = ReconstructionActorTimeline.Evaluate(victim, events, "generic", 11f);

            Assert.IsTrue(attacker.visible && target.visible);
            Assert.Greater(Vector3.Distance(attacker.position, target.position), 0.5f, "attacker and target must not render at the same point during the attack beat");
        }

        [Test]
        public void TwoActorsSharingTheTalkSlot_AreStagedApart()
        {
            var culprit = MakeActor("c", "culprit", 0, 100, (0, "interaction"));
            var victim = MakeActor("v", "victim", 0, 100, (0, "interaction"));
            var events = new List<ReconstructionEventData>();

            var a = ReconstructionActorTimeline.Evaluate(culprit, events, "corridor", 0f);
            var b = ReconstructionActorTimeline.Evaluate(victim, events, "corridor", 0f);

            Assert.Greater(Vector3.Distance(a.position, b.position), 0.5f);
        }

        [Test]
        public void StagingOffset_IsDeterministic_AndOnlyLateral()
        {
            var basePos = ReconstructionZoneLayout.GetZonePosition("street", "crime_point");
            var first = ReconstructionZoneLayout.GetActorZonePosition("street", "crime_point", "victim");
            var second = ReconstructionZoneLayout.GetActorZonePosition("street", "crime_point", "victim");

            Assert.AreEqual(first, second, "same role and slot must always stage to the same point");
            Assert.AreEqual(basePos.y, first.y, "staging offsets never lift an actor off the floor");
            Assert.AreEqual(basePos.z, first.z, "staging offsets are lateral only");
        }

        [Test]
        public void UnknownRole_StagesOnTheSlotItself_NeverThrows()
        {
            var slot = ReconstructionZoneLayout.GetZonePosition("shop", "exit");
            Assert.AreEqual(slot, ReconstructionZoneLayout.GetActorZonePosition("shop", "exit", "some_unmapped_role"));
            Assert.AreEqual(slot, ReconstructionZoneLayout.GetActorZonePosition("shop", "exit", null));
        }

        [Test]
        public void SameInputs_ProduceIdenticalPose_RepeatedCalls()
        {
            var actor = MakeActor("a", "culprit", 0, 100, (0, "interaction"), (20, "crime_point"), (60, "exit"));
            var events = new List<ReconstructionEventData>();

            var poseA = ReconstructionActorTimeline.Evaluate(actor, events, "generic", 35f);
            var poseB = ReconstructionActorTimeline.Evaluate(actor, events, "generic", 35f);

            Assert.AreEqual(poseA.position, poseB.position);
            Assert.AreEqual(poseA.animState, poseB.animState);
            Assert.AreEqual(poseA.normalizedTime, poseB.normalizedTime);
            Assert.AreEqual(poseA.visible, poseB.visible);
        }

        [Test]
        public void Seek_ForwardThenBackward_ReproducesIdenticalState()
        {
            var actor = MakeActor("a", "culprit", 0, 100, (0, "interaction"), (20, "crime_point"), (60, "exit"));
            var events = new List<ReconstructionEventData>();

            var at10First = ReconstructionActorTimeline.Evaluate(actor, events, "generic", 10f);
            var at40 = ReconstructionActorTimeline.Evaluate(actor, events, "generic", 40f);
            var at10Second = ReconstructionActorTimeline.Evaluate(actor, events, "generic", 10f);

            Assert.AreEqual(at10First.position, at10Second.position);
            Assert.AreEqual(at10First.animState, at10Second.animState);
            Assert.AreEqual(at10First.normalizedTime, at10Second.normalizedTime);
            Assert.AreNotEqual(at10First.position, at40.position, "sanity: different times should generally differ in position for a moving actor");
        }

        [Test]
        public void PlaybackSpeed_NeverAffectsPoseAtAGivenAbsoluteTime()
        {
            // Evaluate() has no speed parameter at all — the only way
            // "speed" can matter is via how CurrentTime is advanced
            // upstream (ReconstructionPlaybackController.Update), never in
            // pose evaluation itself. Reaching t=30 via many small steps
            // (simulating slow/fast playback) must equal reaching it directly.
            var actor = MakeActor("a", "culprit", 0, 100, (0, "interaction"), (20, "crime_point"), (60, "exit"));
            var events = new List<ReconstructionEventData>();

            var direct = ReconstructionActorTimeline.Evaluate(actor, events, "generic", 30f);

            float t = 0f;
            for (var i = 0; i < 300; i++)
            {
                t += 0.1f; // simulates many small fast-playback steps
            }
            var stepped = ReconstructionActorTimeline.Evaluate(actor, events, "generic", t);

            Assert.AreEqual(30f, t, 0.001f);
            // A tolerance-based comparison, not exact equality: `t` itself
            // carries the usual float-accumulation drift from 300 additions
            // (an artifact of this test's own simulated stepping, not of
            // Evaluate() — see the `t` assertion above), so the resulting
            // pose is compared with the same generous tolerance rather than
            // asserting byte-identical floats from two different t values.
            Assert.Less(Vector3.Distance(direct.position, stepped.position), 0.01f);
            Assert.AreEqual(direct.animState, stepped.animState);
        }

        [Test]
        public void Restart_AtTimeZero_MatchesFirstWaypoint()
        {
            var actor = MakeActor("a", "culprit", 0, 100, (0, "interaction"), (20, "crime_point"));
            var events = new List<ReconstructionEventData>();
            var pose = ReconstructionActorTimeline.Evaluate(actor, events, "generic", 0f);
            Assert.IsTrue(pose.visible);
            Assert.AreEqual(ReconstructionZoneLayout.GetActorZonePosition("generic", "interaction", "culprit"), pose.position);
        }

        [Test]
        public void ActorNotVisible_BeforeSpawnTime()
        {
            var actor = MakeActor("a", "unnamed", 50, 100, (50, "crime_point"));
            var events = new List<ReconstructionEventData>();
            var pose = ReconstructionActorTimeline.Evaluate(actor, events, "generic", 10f);
            Assert.IsFalse(pose.visible);
        }

        [Test]
        public void ActorNotVisible_AfterDespawnTime()
        {
            var actor = MakeActor("a", "culprit", 0, 30, (0, "interaction"));
            var events = new List<ReconstructionEventData>();
            var pose = ReconstructionActorTimeline.Evaluate(actor, events, "generic", 31f);
            Assert.IsFalse(pose.visible);
        }

        [Test]
        public void Discoverer_NeverVisibleBeforeOwnSpawnTime()
        {
            var discoverer = MakeActor("d", "unnamed", 800f, 820f, (800f, "crime_point"));
            var events = new List<ReconstructionEventData>();
            Assert.IsFalse(ReconstructionActorTimeline.Evaluate(discoverer, events, "generic", 799.9f).visible);
            Assert.IsTrue(ReconstructionActorTimeline.Evaluate(discoverer, events, "generic", 800f).visible);
        }

        [Test]
        public void Culprit_NeverVisibleAfterDespawnTime()
        {
            var culprit = MakeActor("c", "culprit", 0f, 60f, (0, "interaction"), (60, "exit"));
            var events = new List<ReconstructionEventData>();
            Assert.IsTrue(ReconstructionActorTimeline.Evaluate(culprit, events, "generic", 60f).visible);
            Assert.IsFalse(ReconstructionActorTimeline.Evaluate(culprit, events, "generic", 60.1f).visible);
        }

        [Test]
        public void Victim_CollapsesDeterministically_AfterAttackBeat()
        {
            var victim = MakeActor("victim", "victim", 0f, 40f, (0, "interaction"), (10, "crime_point"));
            var events = new List<ReconstructionEventData> { MakeAttackEvent(10f, "culprit", "victim") };

            var duringBeat = ReconstructionActorTimeline.Evaluate(victim, events, "generic", 11f);
            Assert.AreEqual("Idle", duringBeat.animState, "victim should not fight back / no invented struggle during the beat");

            var afterBeat = ReconstructionActorTimeline.Evaluate(victim, events, "generic", 10f + ReconstructionActorTimeline.AttackBeatSeconds + 0.5f);
            Assert.AreEqual("Collapse", afterBeat.animState);

            var afterBeatAgain = ReconstructionActorTimeline.Evaluate(victim, events, "generic", 10f + ReconstructionActorTimeline.AttackBeatSeconds + 0.5f);
            Assert.AreEqual(afterBeat.position, afterBeatAgain.position);
            Assert.AreEqual(afterBeat.normalizedTime, afterBeatAgain.normalizedTime);
        }

        [Test]
        public void Victim_AfterTheAttack_HoldsTheCollapsedBodyUntilDespawn_NeverIdleOrWalkAgain()
        {
            var victim = MakeActor("victim", "victim", 0f, 600f, (0, "interaction"), (10, "crime_point"));
            var events = new List<ReconstructionEventData> { MakeAttackEvent(10f, "culprit", "victim") };
            var settled = ReconstructionActorTimeline.Evaluate(victim, events, "generic", 20f);

            foreach (var t in new[] { 20f, 100f, 400f, 599f, 600f })
            {
                var pose = ReconstructionActorTimeline.Evaluate(victim, events, "generic", t);
                Assert.IsTrue(pose.visible, $"the body stays present at t={t}");
                Assert.AreEqual("Collapse", pose.animState, $"t={t}");
                Assert.AreEqual(1f, pose.normalizedTime, $"fully collapsed, never re-animating, t={t}");
                Assert.IsFalse(pose.isWalking, $"t={t}");
                Assert.AreEqual(settled.position, pose.position, $"the body never moves, t={t}");
            }
            Assert.IsFalse(ReconstructionActorTimeline.Evaluate(victim, events, "generic", 600.1f).visible);
        }

        [Test]
        public void SeekingAcrossTheAttack_RestoresTheLivingPoseBefore_AndTheIdenticalBodyAfter()
        {
            var victim = MakeActor("victim", "victim", 0f, 600f, (0, "interaction"), (10, "crime_point"));
            var events = new List<ReconstructionEventData> { MakeAttackEvent(10f, "culprit", "victim") };

            var bodyFirst = ReconstructionActorTimeline.Evaluate(victim, events, "generic", 400f);
            var beforeAttack = ReconstructionActorTimeline.Evaluate(victim, events, "generic", 5f);
            var bodyAgain = ReconstructionActorTimeline.Evaluate(victim, events, "generic", 400f);

            Assert.AreNotEqual("Collapse", beforeAttack.animState);
            Assert.AreEqual(bodyFirst.animState, bodyAgain.animState);
            Assert.AreEqual(bodyFirst.position, bodyAgain.position);
            Assert.AreEqual(bodyFirst.normalizedTime, bodyAgain.normalizedTime);
        }

        [Test]
        public void Culprit_ShowsAttackAnimState_DuringBeat_ThenResumesWaypoints()
        {
            var culprit = MakeActor("culprit", "culprit", 0f, 40f, (0, "interaction"), (10, "crime_point"), (20, "exit"));
            var events = new List<ReconstructionEventData> { MakeAttackEvent(10f, "culprit", "victim", "attack_strangle") };

            var duringBeat = ReconstructionActorTimeline.Evaluate(culprit, events, "generic", 10.5f);
            Assert.AreEqual("AttackStrangle", duringBeat.animState);

            var afterBeat = ReconstructionActorTimeline.Evaluate(culprit, events, "generic", 10f + ReconstructionActorTimeline.AttackBeatSeconds + 1f);
            Assert.AreEqual("Walk", afterBeat.animState, "culprit resumes ordinary waypoint travel toward exit after the beat");
        }

        [TestCase("attack_strike", "AttackStrike")]
        [TestCase("attack_strangle", "AttackStrangle")]
        [TestCase("attack_stab", "AttackStab")]
        [TestCase("attack_firearm", "AttackFirearm")]
        [TestCase("attack_push", "AttackPush")]
        [TestCase("attack_administer_substance", "NeutralInteraction")]
        public void EverySafeVisualAction_ShowsItsOwnBeat(string safeVisualAction, string expectedState)
        {
            var culprit = MakeActor("culprit", "culprit", 0f, 40f, (0, "crime_point"));
            var events = new List<ReconstructionEventData> { MakeAttackEvent(0f, "culprit", "victim", safeVisualAction) };

            var pose = ReconstructionActorTimeline.Evaluate(culprit, events, "generic", 0.5f);
            Assert.AreEqual(expectedState, pose.animState);
            Assert.AreEqual(expectedState, ReconstructionActorTimeline.AnimStateForSafeVisualAction(safeVisualAction));
        }

        [Test]
        public void UnknownSafeVisualAction_FallsBackToTheNeutralBeat_NeverToABlow()
        {
            var culprit = MakeActor("culprit", "culprit", 0f, 40f, (0, "crime_point"));
            var events = new List<ReconstructionEventData> { MakeAttackEvent(0f, "culprit", "victim", "attack_some_future_method") };
            ReconstructionActorPose pose = default;
            Assert.DoesNotThrow(() => pose = ReconstructionActorTimeline.Evaluate(culprit, events, "generic", 0.5f));
            Assert.AreEqual("NeutralInteraction", pose.animState, "an action this build does not know must never be shown as a physical attack");
        }

        [Test]
        public void EveryAttackBeat_IsShownExactlyOnce_AndOnlyToTheAttacker()
        {
            foreach (var action in new[] { "attack_strike", "attack_strangle", "attack_stab", "attack_firearm", "attack_push", "attack_administer_substance" })
            {
                var culprit = MakeActor("culprit", "culprit", 0f, 200f, (0, "crime_point"));
                var victim = MakeActor("victim", "victim", 0f, 200f, (0, "crime_point"));
                var events = new List<ReconstructionEventData> { MakeAttackEvent(10f, "culprit", "victim", action) };
                var expected = ReconstructionActorTimeline.AnimStateForSafeVisualAction(action);

                Assert.AreEqual("Idle", ReconstructionActorTimeline.Evaluate(culprit, events, "generic", 9.9f).animState, action);
                Assert.AreEqual(expected, ReconstructionActorTimeline.Evaluate(culprit, events, "generic", 10.5f).animState, action);
                Assert.AreEqual("Idle", ReconstructionActorTimeline.Evaluate(culprit, events, "generic", 10f + ReconstructionActorTimeline.AttackBeatSeconds + 0.1f).animState, action);
                Assert.AreEqual("Idle", ReconstructionActorTimeline.Evaluate(victim, events, "generic", 10.5f).animState, $"{action}: no invented struggle");
            }
        }

        [Test]
        public void StagingEvent_ShowsOneGenericManipulationBeat_ForItsOwnActorOnly()
        {
            var culprit = MakeActor("culprit", "culprit", 0f, 200f, (0, "crime_point"));
            var other = MakeActor("other", "unnamed", 0f, 200f, (0, "crime_point"));
            var staging = new ReconstructionEventData
            {
                time = 40f,
                type = "stage_scene",
                actorVisualId = "culprit",
                locationSlot = "crime_point",
                safeVisualAction = "manipulate_scene",
            };
            var events = new List<ReconstructionEventData> { MakeAttackEvent(10f, "culprit", "victim"), staging };

            Assert.AreEqual("ManipulateScene", ReconstructionActorTimeline.Evaluate(culprit, events, "generic", 40.5f).animState);
            Assert.AreEqual("Idle", ReconstructionActorTimeline.Evaluate(culprit, events, "generic", 40f + ReconstructionActorTimeline.StageBeatSeconds + 0.1f).animState);
            Assert.AreEqual("Idle", ReconstructionActorTimeline.Evaluate(other, events, "generic", 40.5f).animState, "staging is never acted out by anyone else");
        }

        [Test]
        public void ALongLeg_WaitsAtThePreviousSlot_ThenWalksItsLastSeconds_ArrivingExactlyOnTime()
        {
            var culprit = MakeActor("culprit", "culprit", 0f, 900f, (0, "interaction"), (600, "crime_point"));
            var events = new List<ReconstructionEventData>();

            var early = ReconstructionActorTimeline.Evaluate(culprit, events, "generic", 100f);
            var justBeforeWalk = ReconstructionActorTimeline.Evaluate(culprit, events, "generic", 600f - ReconstructionActorTimeline.MaxWalkSeconds - 1f);
            var walking = ReconstructionActorTimeline.Evaluate(culprit, events, "generic", 600f - 2f);
            var arrived = ReconstructionActorTimeline.Evaluate(culprit, events, "generic", 600f);

            Assert.AreEqual("Idle", early.animState, "an actor waits where truth last placed them instead of crawling across the scene");
            Assert.AreEqual(early.position, justBeforeWalk.position);
            Assert.AreEqual("Walk", walking.animState);
            Assert.AreNotEqual(early.position, arrived.position);
            Assert.AreEqual(ReconstructionZoneLayout.GetActorZonePosition("generic", "crime_point", "culprit"), arrived.position);
        }

        [Test]
        public void ShortLegs_StillWalkTheWholeInterval()
        {
            var culprit = MakeActor("culprit", "culprit", 0f, 900f, (0, "interaction"), (4, "crime_point"));
            var walking = ReconstructionActorTimeline.Evaluate(culprit, new List<ReconstructionEventData>(), "generic", 2f);
            Assert.AreEqual("Walk", walking.animState);
        }

        [Test]
        public void NewBeats_AreDeterministic_ForwardAndBackward_AtEverySpeed()
        {
            var culprit = MakeActor("culprit", "culprit", 0f, 200f, (0, "interaction"), (60, "crime_point"), (120, "exit"));
            var events = new List<ReconstructionEventData>
            {
                MakeAttackEvent(60f, "culprit", "victim", "attack_stab"),
                new ReconstructionEventData { time = 90f, type = "stage_scene", actorVisualId = "culprit", locationSlot = "crime_point", safeVisualAction = "manipulate_scene" },
            };
            var times = new[] { 0f, 30f, 55f, 60.5f, 62.5f, 90.5f, 100f, 119f, 150f };

            var forward = new List<ReconstructionActorPose>();
            foreach (var t in times) forward.Add(ReconstructionActorTimeline.Evaluate(culprit, events, "generic", t));

            for (var i = times.Length - 1; i >= 0; i--)
            {
                var again = ReconstructionActorTimeline.Evaluate(culprit, events, "generic", times[i]);
                Assert.AreEqual(forward[i].animState, again.animState, $"t={times[i]}");
                Assert.AreEqual(forward[i].position, again.position, $"t={times[i]}");
                Assert.AreEqual(forward[i].normalizedTime, again.normalizedTime, $"t={times[i]}");
            }
        }
    }

    /// <summary>U5.6 iteration 1 — the colocation-facing fix (actors sharing a slot face each other instead of a
    /// fixed `Vector3.forward`), kept in its own fixture class so every pre-existing test above (none of which pass
    /// `allActors`) is provably unaffected by this feature — they exercise the exact 4-argument overload that still
    /// behaves exactly as before.</summary>
    public class ReconstructionActorTimelineColocationFacingTests
    {
        private static ReconstructionActorData MakeActor(string visualId, string role, float spawn, float despawn, params (float time, string slot)[] waypoints)
        {
            var actor = new ReconstructionActorData
            {
                visualId = visualId,
                roleForReconstruction = role,
                genericAppearance = "casual_neutral",
                spawnTime = spawn,
                despawnTime = despawn,
                waypoints = new List<ReconstructionWaypointData>(),
            };
            foreach (var (time, slot) in waypoints)
            {
                actor.waypoints.Add(new ReconstructionWaypointData { time = time, slot = slot });
            }
            return actor;
        }

        [Test]
        public void OmittingAllActors_PreservesExactPriorBehavior_FixedForward()
        {
            var culprit = MakeActor("c", "culprit", 0, 100, (0, "interaction"));
            var events = new List<ReconstructionEventData>();

            var pose = ReconstructionActorTimeline.Evaluate(culprit, events, "corridor", 0f); // no allActors — old call shape
            Assert.AreEqual(Vector3.forward, pose.facing);

            var poseWithEmptyRoster = ReconstructionActorTimeline.Evaluate(culprit, events, "corridor", 0f, new List<ReconstructionActorData>());
            Assert.AreEqual(Vector3.forward, poseWithEmptyRoster.facing, "no colocated actor exists in an empty roster, so this must still fall back to forward");
        }

        [Test]
        public void TwoActorsSharingTheTalkSlot_FaceEachOther_NotAFixedDirection()
        {
            var culprit = MakeActor("c", "culprit", 0, 100, (0, "interaction"));
            var victim = MakeActor("v", "victim", 0, 100, (0, "interaction"));
            var roster = new List<ReconstructionActorData> { culprit, victim };
            var events = new List<ReconstructionEventData>();

            var a = ReconstructionActorTimeline.Evaluate(culprit, events, "corridor", 0f, roster);
            var b = ReconstructionActorTimeline.Evaluate(victim, events, "corridor", 0f, roster);

            Assert.AreNotEqual(Vector3.forward, a.facing, "culprit should now turn toward the victim instead of the fixed default");
            Assert.AreNotEqual(Vector3.forward, b.facing, "victim should now turn toward the culprit instead of the fixed default");
            // culprit is at -0.55 on x, victim at +0.55 -> culprit must face toward +x, victim toward -x.
            Assert.Greater(a.facing.x, 0f);
            Assert.Less(b.facing.x, 0f);
        }

        [Test]
        public void AttackerAndTarget_FaceEachOther_DuringTheAttackBeat()
        {
            var culprit = MakeActor("c", "culprit", 0, 100, (0, "crime_point"));
            var victim = MakeActor("v", "victim", 0, 100, (0, "crime_point"));
            var roster = new List<ReconstructionActorData> { culprit, victim };
            var events = new List<ReconstructionEventData>
            {
                new() { time = 0f, type = "attack", actorVisualId = "c", counterpartyVisualId = "v", locationSlot = "crime_point", safeVisualAction = "attack_strike" },
            };

            var attacker = ReconstructionActorTimeline.Evaluate(culprit, events, "generic", 0.5f, roster);
            var target = ReconstructionActorTimeline.Evaluate(victim, events, "generic", 0.5f, roster);

            Assert.Greater(attacker.facing.x, 0f, "attacker (culprit, x=-0.55) should face toward the target (victim, x=+0.55)");
            Assert.Less(target.facing.x, 0f, "target should face back toward the attacker");
        }

        [Test]
        public void ActorsAtDifferentSlots_DoNotFaceEachOther_StillDefaultForward()
        {
            var atEntrance = MakeActor("a", "culprit", 0, 100, (0, "entrance"));
            var atExit = MakeActor("b", "victim", 0, 100, (0, "exit"));
            var roster = new List<ReconstructionActorData> { atEntrance, atExit };
            var events = new List<ReconstructionEventData>();

            var poseA = ReconstructionActorTimeline.Evaluate(atEntrance, events, "generic", 0f, roster);
            Assert.AreEqual(Vector3.forward, poseA.facing, "far apart at different slots — must not face a distant unrelated actor");
        }

        [Test]
        public void WalkingActor_KeepsFacingItsTravelDirection_NeverOverriddenByColocation()
        {
            var walker = MakeActor("a", "culprit", 0, 100, (0, "entrance"), (10, "crime_point"));
            var bystander = MakeActor("b", "victim", 0, 100, (0, "crime_point"));
            var roster = new List<ReconstructionActorData> { walker, bystander };
            var events = new List<ReconstructionEventData>();

            var pose = ReconstructionActorTimeline.Evaluate(walker, events, "generic", 9f, roster); // mid-walk, arriving at t=10
            Assert.IsTrue(pose.isWalking);
            var expectedDir = (ReconstructionZoneLayout.GetActorZonePosition("generic", "crime_point", "culprit") - ReconstructionZoneLayout.GetActorZonePosition("generic", "entrance", "culprit")).normalized;
            Assert.AreEqual(expectedDir, pose.facing, "walking direction must never be overridden by colocation facing");
        }

        [Test]
        public void ColocationFacing_IsDeterministic_RepeatedCallsIdentical()
        {
            var a = MakeActor("a", "culprit", 0, 100, (0, "interaction"));
            var b = MakeActor("b", "victim", 0, 100, (0, "interaction"));
            var roster = new List<ReconstructionActorData> { a, b };
            var events = new List<ReconstructionEventData>();

            var first = ReconstructionActorTimeline.Evaluate(a, events, "corridor", 5f, roster);
            var second = ReconstructionActorTimeline.Evaluate(a, events, "corridor", 5f, roster);
            Assert.AreEqual(first.facing, second.facing);
        }

        [Test]
        public void ColocationFacing_IsIndependentOfActorIdentity_OnlyPositionMatters()
        {
            // Two different visualId/genericAppearance pairings staged identically must produce identical facing —
            // guards against facing ever being derived from identity rather than pure staged position.
            var setA = new List<ReconstructionActorData>
            {
                MakeActor("person_1", "culprit", 0, 100, (0, "interaction")),
                MakeActor("person_2", "victim", 0, 100, (0, "interaction")),
            };
            var setB = new List<ReconstructionActorData>
            {
                MakeActor("person_zz9", "culprit", 0, 100, (0, "interaction")),
                MakeActor("person_qq3", "victim", 0, 100, (0, "interaction")),
            };
            var events = new List<ReconstructionEventData>();

            var poseA = ReconstructionActorTimeline.Evaluate(setA[0], events, "corridor", 0f, setA);
            var poseB = ReconstructionActorTimeline.Evaluate(setB[0], events, "corridor", 0f, setB);
            Assert.AreEqual(poseA.facing, poseB.facing);
        }

        [Test]
        public void AccompliceAndUnnamed_WiderOffset_StillCountsAsColocated()
        {
            var accomplice = MakeActor("a", "accomplice", 0, 100, (0, "interaction"));
            var unnamed = MakeActor("u", "unnamed", 0, 100, (0, "interaction"));
            var roster = new List<ReconstructionActorData> { accomplice, unnamed };
            var events = new List<ReconstructionEventData>();

            var pose = ReconstructionActorTimeline.Evaluate(accomplice, events, "corridor", 0f, roster);
            Assert.AreNotEqual(Vector3.forward, pose.facing, "the wider accomplice/unnamed 2.7m gap must still count as the same staged slot");
        }
    }
}
