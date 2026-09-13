using UnityEngine;

namespace Caseline.CCTV
{
    /// <summary>Everything about an actor at one instant — a pure snapshot,
    /// never a delta. See <see cref="CCTVActorTimeline.Evaluate"/>.</summary>
    public struct CCTVActorState
    {
        public bool visible;
        public Vector3 position;
        public Vector3 facing;
        public bool isWalking;
    }

    /// <summary>
    /// Pure "state = f(time)" evaluation for one actor (Phase U1, req. 13).
    /// Every method here is a static, side-effect-free function of its
    /// inputs — no MonoBehaviour, no accumulated state, no `Time.deltaTime`.
    /// This is deliberately the same architectural pattern CASELINE's own
    /// 2D CCTV renderer uses (`computeActorPose` in
    /// `lib/art/cctv-actor-pose.ts`): position and walk-cycle phase are both
    /// derived directly from an absolute timeline value, so scrubbing to
    /// t=7 always looks identical whether you played through to it or
    /// jumped straight there, and playback speed can never change the path
    /// itself — only how fast `time` advances.
    /// </summary>
    public static class CCTVActorTimeline
    {
        /// <summary>The actor's position/visibility/facing at one instant.
        /// Before <c>startTime</c> the actor is not visible at all; from
        /// <c>startTime</c> to <c>endTime</c> it linearly interpolates
        /// start→end and faces its direction of travel; at/after
        /// <c>endTime</c> it stays at rest at <c>endPosition</c>, idle.</summary>
        public static CCTVActorState Evaluate(CCTVActorData actor, float time)
        {
            var start = CCTVVectorUtil.ToVector3(actor.startPosition);
            var end = CCTVVectorUtil.ToVector3(actor.endPosition);

            if (time < actor.startTime)
            {
                return new CCTVActorState { visible = false, position = start, facing = Vector3.forward, isWalking = false };
            }

            var span = Mathf.Max(0.0001f, actor.endTime - actor.startTime);
            var t = Mathf.Clamp01((Mathf.Min(time, actor.endTime) - actor.startTime) / span);
            var position = Vector3.Lerp(start, end, t);

            var delta = end - start;
            var hasTravel = delta.sqrMagnitude > 0.0001f;
            var facing = hasTravel ? delta.normalized : Vector3.forward;
            var isWalking = hasTravel && time < actor.endTime;

            return new CCTVActorState { visible = true, position = position, facing = facing, isWalking = isWalking };
        }

        /// <summary>Normalized (0-1, wrapping) walk-cycle phase at `time`,
        /// derived from DISTANCE TRAVELED so far (never elapsed real time)
        /// divided by `strideLength` — the same "distance, not clock"
        /// derivation `computeActorPose` uses, so the walk cycle can never
        /// drift out of sync with how far the actor has actually
        /// moved (no foot-sliding regardless of playback speed/seeking).
        /// Returns 0 when the actor isn't walking (idle stance).</summary>
        public static float WalkCyclePhase(CCTVActorData actor, float time, float strideLength)
        {
            var state = Evaluate(actor, time);
            if (!state.isWalking) return 0f;

            var start = CCTVVectorUtil.ToVector3(actor.startPosition);
            var end = CCTVVectorUtil.ToVector3(actor.endPosition);
            var totalDistance = Vector3.Distance(start, end);

            var span = Mathf.Max(0.0001f, actor.endTime - actor.startTime);
            var t = Mathf.Clamp01((time - actor.startTime) / span);
            var distanceTraveled = totalDistance * t;

            var cycles = distanceTraveled / Mathf.Max(0.01f, strideLength);
            return cycles - Mathf.Floor(cycles);
        }
    }
}
