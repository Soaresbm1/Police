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
