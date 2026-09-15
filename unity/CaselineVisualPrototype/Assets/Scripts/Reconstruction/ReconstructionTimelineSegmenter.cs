using System.Collections.Generic;

namespace Caseline.Reconstruction
{
    public readonly struct ReconstructionTimelineSegment
    {
        public readonly float StartTime;
        public readonly float EndTime;
        /// <summary>True when this segment spans a truth-time gap large
        /// enough that a presentation layer may want to visually compress
        /// it (a scrubber jump, a "Plus tard..." transition) rather than
        /// make a viewer sit through it in real time. Never changes what
        /// `StartTime`/`EndTime` actually are — those remain the real,
        /// uncompressed truth timestamps (in reconstruction-normalized
        /// seconds) at all times.</summary>
        public readonly bool IsCompressibleGap;

        public ReconstructionTimelineSegment(float startTime, float endTime, bool isCompressibleGap)
        {
            StartTime = startTime;
            EndTime = endTime;
            IsCompressibleGap = isCompressibleGap;
        }
    }

    /// <summary>
    /// Phase U5.2.1 §8 — a pure, read-only design prototype for a future
    /// presentation-only "skip inactive gap" feature (U5.3's own UI work,
    /// not built here). Splits a scenario's own event timeline into
    /// segments, flagging any gap between consecutive events wider than
    /// <see cref="GapThresholdSeconds"/> as compressible. Never mutates
    /// `ReconstructionScenario`, never rewrites an event's `time`, never
    /// invents actor presence during a compressed gap — this is purely a
    /// read-only lens over the same, already-correct timestamps a future
    /// scrubber/overlay could use to decide where to visually jump.
    /// </summary>
    public static class ReconstructionTimelineSegmenter
    {
        /// <summary>30 minutes of truth-time with no semantic event.
        /// Calibrated against the real exported POC, whose gaps are 9 min
        /// (talk-&gt;attack), 10 min (attack-&gt;leave_scene), 10.75 h
        /// (leave_scene-&gt;discover) and 10 min (discover-&gt;end): the
        /// minutes-long in-scene gaps are part of the sequence a viewer
        /// should see, and only the multi-hour dead period between the
        /// culprit leaving and the body being discovered is worth
        /// compressing. 30 min sits far above the former and far below the
        /// latter, so the classification is not sensitive to the exact
        /// value.</summary>
        public const float GapThresholdSeconds = 1800f;

        public static List<ReconstructionTimelineSegment> ComputeSegments(ReconstructionScenarioData scenario)
        {
            var segments = new List<ReconstructionTimelineSegment>();
            if (scenario == null || scenario.events == null || scenario.events.Count == 0)
            {
                return segments;
            }

            var eventTimes = new List<float>();
            foreach (var e in scenario.events)
            {
                if (!eventTimes.Contains(e.time)) eventTimes.Add(e.time);
            }
            eventTimes.Sort();

            var cursor = 0f;
            foreach (var t in eventTimes)
            {
                if (t > cursor)
                {
                    var gap = t - cursor;
                    segments.Add(new ReconstructionTimelineSegment(cursor, t, gap >= GapThresholdSeconds));
                }
                cursor = t;
            }
            if (scenario.durationSeconds > cursor)
            {
                var gap = scenario.durationSeconds - cursor;
                segments.Add(new ReconstructionTimelineSegment(cursor, scenario.durationSeconds, gap >= GapThresholdSeconds));
            }

            return segments;
        }
    }
}
