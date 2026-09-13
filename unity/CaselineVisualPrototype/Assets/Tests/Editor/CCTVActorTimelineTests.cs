using Caseline.CCTV;
using NUnit.Framework;
using UnityEngine;

namespace Caseline.CCTV.Tests
{
    public class CCTVActorTimelineTests
    {
        private static CCTVActorData MakeActor(float start = 1f, float end = 11f)
        {
            return new CCTVActorData
            {
                visualId = "actor-1",
                identified = false,
                startTime = start,
                endTime = end,
                startPosition = new[] { -4f, 0f, 3f },
                endPosition = new[] { 4f, 0f, 3f },
                walkSpeed = 1.4f,
            };
        }

        [Test]
        public void NotVisibleBeforeStartTime()
        {
            var actor = MakeActor();
            var state = CCTVActorTimeline.Evaluate(actor, 0.5f);
            Assert.IsFalse(state.visible);
        }

        [Test]
        public void VisibleAndAtStartPosition_AtStartTime()
        {
            var actor = MakeActor();
            var state = CCTVActorTimeline.Evaluate(actor, actor.startTime);
            Assert.IsTrue(state.visible);
            Assert.AreEqual(CCTVVectorUtil.ToVector3(actor.startPosition), state.position);
        }

        [Test]
        public void AtMidpointTime_PositionIsTheGeometricMidpoint()
        {
            var actor = MakeActor();
            var midTime = (actor.startTime + actor.endTime) / 2f;
            var state = CCTVActorTimeline.Evaluate(actor, midTime);
            var expected = Vector3.Lerp(CCTVVectorUtil.ToVector3(actor.startPosition), CCTVVectorUtil.ToVector3(actor.endPosition), 0.5f);
            Assert.That(Vector3.Distance(state.position, expected), Is.LessThan(0.001f));
            Assert.IsTrue(state.isWalking);
        }

        [Test]
        public void AtEndTime_PositionIsEndPositionAndNoLongerWalking()
        {
            var actor = MakeActor();
            var state = CCTVActorTimeline.Evaluate(actor, actor.endTime);
            Assert.AreEqual(CCTVVectorUtil.ToVector3(actor.endPosition), state.position);
            Assert.IsFalse(state.isWalking);
        }

        [Test]
        public void AfterEndTime_StaysAtEndPositionIdle()
        {
            var actor = MakeActor();
            var state = CCTVActorTimeline.Evaluate(actor, actor.endTime + 100f);
            Assert.IsTrue(state.visible);
            Assert.AreEqual(CCTVVectorUtil.ToVector3(actor.endPosition), state.position);
            Assert.IsFalse(state.isWalking);
        }

        [Test]
        public void SameJsonSameTime_AlwaysYieldsTheSameState()
        {
            var actor = MakeActor();
            var a = CCTVActorTimeline.Evaluate(actor, 4.2f);
            var b = CCTVActorTimeline.Evaluate(actor, 4.2f);
            Assert.AreEqual(a.position, b.position);
            Assert.AreEqual(a.visible, b.visible);
            Assert.AreEqual(a.isWalking, b.isWalking);
        }

        [Test]
        public void FacingMatchesTravelDirection()
        {
            var actor = MakeActor();
            var state = CCTVActorTimeline.Evaluate(actor, (actor.startTime + actor.endTime) / 2f);
            var expectedDir = (CCTVVectorUtil.ToVector3(actor.endPosition) - CCTVVectorUtil.ToVector3(actor.startPosition)).normalized;
            Assert.That(Vector3.Dot(state.facing, expectedDir), Is.GreaterThan(0.99f));
        }

        [Test]
        public void WalkCyclePhase_IsZeroWhenIdle()
        {
            var actor = MakeActor();
            Assert.AreEqual(0f, CCTVActorTimeline.WalkCyclePhase(actor, 0f, 1.6f));
            Assert.AreEqual(0f, CCTVActorTimeline.WalkCyclePhase(actor, actor.endTime + 5f, 1.6f));
        }

        [Test]
        public void WalkCyclePhase_IsDeterministicRegardlessOfHowTimeWasReached()
        {
            // The whole point of "state = f(time)" (req. 13): evaluating
            // directly at t=6 must equal what you'd see after playing
            // through to t=6 at any speed, since neither path keeps any
            // history — there IS no "path taken", only the absolute time.
            var actor = MakeActor();
            var direct = CCTVActorTimeline.WalkCyclePhase(actor, 6f, 1.6f);
            var again = CCTVActorTimeline.WalkCyclePhase(actor, 6f, 1.6f);
            Assert.AreEqual(direct, again);
        }

        [Test]
        public void ZeroDisplacementActor_NeverReportsWalking()
        {
            var actor = MakeActor();
            actor.endPosition = (float[])actor.startPosition.Clone();
            var state = CCTVActorTimeline.Evaluate(actor, (actor.startTime + actor.endTime) / 2f);
            Assert.IsFalse(state.isWalking);
            Assert.AreEqual(0f, CCTVActorTimeline.WalkCyclePhase(actor, (actor.startTime + actor.endTime) / 2f, 1.6f));
        }
    }
}
