using System.Collections.Generic;
using UnityEngine;

namespace Caseline.Reconstruction
{
    /// <summary>
    /// Screen-space placement for role labels: a label that would overlap one already placed moves up one lane
    /// until it is clear. Presentation only — actors and slots never move. Labels are placed left to right, ties
    /// broken by key, so the result does not depend on the order actors were spawned in.
    /// </summary>
    public static class ReconstructionLabelLayout
    {
        public readonly struct LabelRequest
        {
            public readonly string Key;
            public readonly Rect Rect;

            public LabelRequest(string key, Rect rect)
            {
                Key = key;
                Rect = rect;
            }
        }

        private const int MaxLanes = 8;

        /// <summary>Horizontal room added on each side of a label's measured text.</summary>
        public const float LabelPaddingX = 4f;

        /// <summary>How far the dark copy drawn under each label is offset, right and down.</summary>
        public const float ShadowOffset = 1f;

        private const float LaneGap = 2f;

        /// <summary>
        /// The rect for a role label whose text measures <paramref name="textSize"/>, centred on
        /// <paramref name="anchorX"/> with its bottom edge at <paramref name="bottomY"/>. IMGUI lays text out in
        /// whole pixels, so a rect exactly as wide as the fractional measured width (78.34 px for COMPLICE) can come
        /// out a fraction narrower than the text, which wraps the last letter onto a clipped second line. The width
        /// is rounded up, padded on both sides and leaves room for the shadow copy; the position is snapped to whole
        /// pixels so placement is deterministic.
        /// </summary>
        public static Rect LabelRect(Vector2 textSize, float anchorX, float bottomY)
        {
            var width = Mathf.Ceil(textSize.x) + 2f * LabelPaddingX + ShadowOffset;
            var height = Mathf.Ceil(textSize.y) + ShadowOffset;
            return new Rect(Mathf.Round(anchorX - width / 2f), Mathf.Round(bottomY - height), width, height);
        }

        /// <summary>Vertical step between lanes: one lane always clears the tallest label.</summary>
        public static float LaneStep(IReadOnlyList<LabelRequest> requests)
        {
            var tallest = 0f;
            foreach (var request in requests) tallest = Mathf.Max(tallest, request.Rect.height);
            return tallest + LaneGap;
        }

        public static Rect[] Resolve(IReadOnlyList<LabelRequest> requests, float laneStep)
        {
            var order = new List<int>(requests.Count);
            for (var i = 0; i < requests.Count; i++) order.Add(i);
            order.Sort((a, b) =>
            {
                var byX = requests[a].Rect.x.CompareTo(requests[b].Rect.x);
                return byX != 0 ? byX : string.CompareOrdinal(requests[a].Key, requests[b].Key);
            });

            var placed = new List<Rect>(requests.Count);
            var result = new Rect[requests.Count];
            foreach (var index in order)
            {
                var rect = requests[index].Rect;
                for (var lane = 0; lane < MaxLanes && OverlapsAny(rect, placed); lane++)
                {
                    rect.y -= laneStep;
                }
                placed.Add(rect);
                result[index] = rect;
            }
            return result;
        }

        private static bool OverlapsAny(Rect rect, List<Rect> placed)
        {
            foreach (var other in placed)
            {
                if (rect.Overlaps(other)) return true;
            }
            return false;
        }
    }
}
