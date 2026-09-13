using System;
using UnityEngine;

namespace Caseline.CCTV
{
    /// <summary>
    /// The one centralized demo clock (Phase U1, req. 13/14). Owns
    /// `currentTime`/play/pause/speed/restart; every other CCTV component
    /// reads `CurrentTime` and derives its own state from it — nothing else
    /// in this prototype accumulates its own independent timer.
    /// </summary>
    public class CCTVPlaybackController : MonoBehaviour
    {
        public CCTVScenarioData Scenario { get; private set; }
        public float CurrentTime { get; private set; }
        public bool IsPlaying { get; private set; }
        public float PlaybackSpeed { get; private set; } = 1f;

        /// <summary>Fired whenever CurrentTime changes — Play mode ticking,
        /// a manual Seek, or a Restart. Subscribers (actor controllers,
        /// overlay) always re-derive their own visuals from the new time,
        /// never from an incremental delta.</summary>
        public event Action<float> TimeChanged;

        public void Load(CCTVScenarioData scenario)
        {
            Scenario = scenario;
            CurrentTime = 0f;
            IsPlaying = false;
            TimeChanged?.Invoke(CurrentTime);
        }

        public void Play() => IsPlaying = Scenario != null;

        public void Pause() => IsPlaying = false;

        public void Restart()
        {
            CurrentTime = 0f;
            IsPlaying = Scenario != null;
            TimeChanged?.Invoke(CurrentTime);
        }

        public void SetSpeed(float speed) => PlaybackSpeed = Mathf.Max(0.01f, speed);

        public void Seek(float time)
        {
            var max = Scenario != null ? Scenario.durationSeconds : 0f;
            CurrentTime = Mathf.Clamp(time, 0f, max);
            TimeChanged?.Invoke(CurrentTime);
        }

        private void Update()
        {
            if (!IsPlaying || Scenario == null) return;

            var next = CurrentTime + Time.deltaTime * PlaybackSpeed;
            if (next >= Scenario.durationSeconds)
            {
                next = Scenario.durationSeconds;
                IsPlaying = false;
            }
            CurrentTime = next;
            TimeChanged?.Invoke(CurrentTime);
        }
    }
}
