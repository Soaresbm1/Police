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
        public void Culprit_ShowsAttackAnimState_DuringBeat_ThenResumesWaypoints()
        {
            var culprit = MakeActor("culprit", "culprit", 0f, 40f, (0, "interaction"), (10, "crime_point"), (20, "exit"));
            var events = new List<ReconstructionEventData> { MakeAttackEvent(10f, "culprit", "victim", "attack_strangle") };

            var duringBeat = ReconstructionActorTimeline.Evaluate(culprit, events, "generic", 10.5f);
            Assert.AreEqual("AttackStrangle", duringBeat.animState);

            var afterBeat = ReconstructionActorTimeline.Evaluate(culprit, events, "generic", 10f + ReconstructionActorTimeline.AttackBeatSeconds + 1f);
            Assert.AreEqual("Walk", afterBeat.animState, "culprit resumes ordinary waypoint travel toward exit after the beat");
        }

        [Test]
        public void UnrecognizedSafeVisualAction_FallsBackToAttackStrike_NeverThrows()
        {
            var culprit = MakeActor("culprit", "culprit", 0f, 40f, (0, "crime_point"));
            var events = new List<ReconstructionEventData> { MakeAttackEvent(0f, "culprit", "victim", "attack_firearm") };
            ReconstructionActorPose pose = default;
            Assert.DoesNotThrow(() => pose = ReconstructionActorTimeline.Evaluate(culprit, events, "generic", 0.5f));
            Assert.AreEqual("AttackStrike", pose.animState);
        }
    }
}
