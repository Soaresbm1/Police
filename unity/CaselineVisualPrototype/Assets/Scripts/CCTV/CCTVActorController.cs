using UnityEngine;

namespace Caseline.CCTV
{
    /// <summary>
    /// Applies one actor's <see cref="CCTVActorTimeline"/> state to a real
    /// GameObject/Animator each time the playback clock changes. Never
    /// decides where the actor is or how fast it walks itself — every
    /// number here comes from <see cref="CCTVActorTimeline"/>, which is a
    /// pure function of the JSON-sourced <see cref="CCTVActorData"/> — this
    /// component is purely the "turn state into a Transform + Animator
    /// pose" layer (mirrors the split between `computeActorPose` and
    /// `CCTVAnimatedPlayer` on the CASELINE 2D side).
    ///
    /// A "low-FPS visual cadence" (req. 11 — cheap CCTV cadence, no
    /// dedicated shader) is applied here: the time actually used to
    /// evaluate pose is snapped to a fixed step rate, giving the same
    /// stepped-motion CCTV feel the 2D renderer gets from quantizing to
    /// `sequence.fps` — the playback clock itself still runs smoothly.
    /// </summary>
    public class CCTVActorController : MonoBehaviour
    {
        [SerializeField] private Animator animator;

        /// <summary>Meters per full walk cycle — cosmetic pacing only, see
        /// <see cref="CCTVActorTimeline.WalkCyclePhase"/>.</summary>
        [SerializeField] private float strideLength = 1.6f;

        /// <summary>Visual sample rate — cosmetic CCTV cadence only, never
        /// affects the underlying timeline evaluation.</summary>
        [SerializeField] private float visualFps = 10f;

        private static readonly int WalkState = Animator.StringToHash("Walk");
        private static readonly int IdleState = Animator.StringToHash("Idle");

        public CCTVActorData Data { get; private set; }

        public void Configure(CCTVActorData data)
        {
            Data = data;
        }

        /// <summary>Re-derives this actor's full visual state from an
        /// absolute timeline value — safe to call repeatedly with the same
        /// `time` (idempotent) or with a time before an earlier call's
        /// (scrubbing backward), since nothing here reads its own previous
        /// output.</summary>
        public void Apply(float time)
        {
            if (Data == null) return;

            var stepSeconds = 1f / Mathf.Max(1f, visualFps);
            var displayTime = Mathf.Floor(time / stepSeconds) * stepSeconds;

            var state = CCTVActorTimeline.Evaluate(Data, displayTime);
            gameObject.SetActive(state.visible);
            if (!state.visible) return;

            transform.position = state.position;
            if (state.isWalking)
            {
                transform.rotation = Quaternion.LookRotation(state.facing, Vector3.up);
            }

            if (animator == null) return;

            if (state.isWalking)
            {
                var phase = CCTVActorTimeline.WalkCyclePhase(Data, displayTime, strideLength);
                animator.Play(WalkState, 0, phase);
            }
            else
            {
                animator.Play(IdleState, 0, 0f);
            }
            // Freeze the Animator's own internal clock — every pose comes
            // from the explicit normalizedTime passed to Play() above, not
            // from Update()-driven playback, so re-applying the same `time`
            // always reproduces the exact same pose.
            animator.speed = 0f;
        }
    }
}
