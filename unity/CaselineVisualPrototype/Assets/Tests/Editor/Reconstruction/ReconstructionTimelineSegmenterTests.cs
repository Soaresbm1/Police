using System.Collections.Generic;
using Caseline.Reconstruction;
using NUnit.Framework;

namespace Caseline.Reconstruction.Tests
{
    public class ReconstructionTimelineSegmenterTests
    {
        private static ReconstructionScenarioData MakeScenario(float durationSeconds, params float[] eventTimes)
        {
            var events = new List<ReconstructionEventData>();
            foreach (var t in eventTimes)
            {
                events.Add(new ReconstructionEventData { time = t, type = "meet", actorVisualId = "a", locationSlot = "entrance" });
            }
            return new ReconstructionScenarioData
            {
                version = 1,
                caseId = "case-1",
                environment = "generic",
                durationSeconds = durationSeconds,
                actors = new List<ReconstructionActorData>(),
                events = events,
            };
        }

        [Test]
        public void RealPocShape_FlagsOnlyTheLeaveSceneToDiscoverGapAsCompressible()
        {
            // Mirrors the real exported POC: talk@0, attack@540,
            // leave_scene@1140, discover@39840, duration=40440.
            var scenario = MakeScenario(40440f, 0f, 540f, 1140f, 39840f);
            var segments = ReconstructionTimelineSegmenter.ComputeSegments(scenario);

            var compressible = segments.FindAll(s => s.IsCompressibleGap);
            Assert.AreEqual(1, compressible.Count, "only the ~10.75h leave_scene->discover gap should compress");
            Assert.AreEqual(1140f, compressible[0].StartTime);
            Assert.AreEqual(39840f, compressible[0].EndTime);

            foreach (var s in segments)
            {
                if (!s.IsCompressibleGap) Assert.Less(s.EndTime - s.StartTime, ReconstructionTimelineSegmenter.GapThresholdSeconds);
            }
        }

        [Test]
        public void NeverAltersEventTimes_SegmentsAreDerivedOnly()
        {
            var scenario = MakeScenario(100f, 0f, 10f, 90f);
            var originalTimes = new List<float>();
            foreach (var e in scenario.events) originalTimes.Add(e.time);

            ReconstructionTimelineSegmenter.ComputeSegments(scenario);

            for (var i = 0; i < scenario.events.Count; i++)
            {
                Assert.AreEqual(originalTimes[i], scenario.events[i].time, "computing segments must never mutate the source events");
            }
        }

        [Test]
        public void SegmentsAreContiguous_CoveringZeroToDuration()
        {
            var scenario = MakeScenario(500f, 0f, 50f, 400f);
            var segments = ReconstructionTimelineSegmenter.ComputeSegments(scenario);

            Assert.Greater(segments.Count, 0);
            Assert.AreEqual(0f, segments[0].StartTime);
            Assert.AreEqual(500f, segments[^1].EndTime);
            for (var i = 1; i < segments.Count; i++)
            {
                Assert.AreEqual(segments[i - 1].EndTime, segments[i].StartTime);
            }
        }

        [Test]
        public void NoEvents_ProducesNoSegments_NeverThrows()
        {
            var scenario = MakeScenario(100f);
            List<ReconstructionTimelineSegment> segments = null;
            Assert.DoesNotThrow(() => segments = ReconstructionTimelineSegmenter.ComputeSegments(scenario));
            Assert.AreEqual(0, segments.Count);
        }

        [Test]
        public void NullScenario_NeverThrows()
        {
            List<ReconstructionTimelineSegment> segments = null;
            Assert.DoesNotThrow(() => segments = ReconstructionTimelineSegmenter.ComputeSegments(null));
            Assert.AreEqual(0, segments.Count);
        }

        [Test]
        public void ShortGapsBelowThreshold_AreNotFlaggedCompressible()
        {
            var scenario = MakeScenario(3000f, 0f, 600f, 1200f, 2900f);
            var segments = ReconstructionTimelineSegmenter.ComputeSegments(scenario);
            foreach (var s in segments)
            {
                Assert.IsFalse(s.IsCompressibleGap, $"segment [{s.StartTime},{s.EndTime}] is under the threshold and should not compress");
            }
        }
    }
}
