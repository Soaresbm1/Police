using System;
using System.Collections.Generic;
using UnityEngine;

namespace Caseline.Reconstruction
{
    /// <summary>
    /// Phase U5.2 — the one centralized reconstruction clock. Owns
    /// `CurrentTime`/play/pause/speed/restart/seek; every other system
    /// (actors, camera, overlay) re-derives its own state from
    /// `CurrentTime` via `ReconstructionSceneController.Evaluate`, never
    /// from an accumulated delta of its own (req. 10/16/22). Same shape as
    /// `CCTVPlaybackController` — independently written, not shared code
    /// (this phase's "keep CCTV and Reconstruction separate" instruction).
    /// </summary>
    public class ReconstructionPlaybackController : MonoBehaviour
    {
        [SerializeField] private ReconstructionSceneController sceneController;

        private readonly List<float> holdPoints = new();

        public ReconstructionScenarioData Scenario => sceneController != null ? sceneController.Scenario : null;
        public float CurrentTime { get; private set; }
        public bool IsPlaying { get; private set; }
        public float PlaybackSpeed { get; private set; } = 1f;

        public event Action<float> TimeChanged;
        public event Action<bool> PlayingChanged;

        /// <summary>Playback stopped itself at a hold point. Truth time rests exactly on the hold point; the host uses
        /// this to present a long inactive gap as a short transition instead of playing through it.</summary>
        public event Action<float> HoldReached;

        public event Action Ended;

        public void Configure(ReconstructionSceneController scene)
        {
            sceneController = scene;
        }

        public void Load(ReconstructionScenarioData scenario)
        {
            holdPoints.Clear();
            sceneController.ApplyScenario(scenario);
            CurrentTime = 0f;
            SetPlaying(false);
            TimeChanged?.Invoke(CurrentTime);
        }

        /// <summary>Truth times at which playing stops itself. Presentation only: seeking is never restricted.</summary>
        public void SetHoldPoints(IEnumerable<float> points)
        {
            holdPoints.Clear();
            if (points != null) holdPoints.AddRange(points);
            holdPoints.Sort();
        }

        public void Play() => SetPlaying(Scenario != null);

        public void Pause() => SetPlaying(false);

        public void Restart()
        {
            CurrentTime = 0f;
            sceneController.Evaluate(CurrentTime);
            TimeChanged?.Invoke(CurrentTime);
            SetPlaying(Scenario != null);
        }

        public void SetSpeed(float speed) => PlaybackSpeed = Mathf.Max(0.01f, speed);

        /// <summary>Deterministic seek — evaluates the whole scene fresh at
        /// the new time regardless of direction (req. 10: t=10 -> t=40 ->
        /// t=10 must reproduce identical state).</summary>
        public void Seek(float time)
        {
            var max = Scenario != null ? Scenario.durationSeconds : 0f;
            CurrentTime = Mathf.Clamp(time, 0f, max);
            sceneController.Evaluate(CurrentTime);
            TimeChanged?.Invoke(CurrentTime);
        }

        public void Step(float deltaSeconds) => Seek(CurrentTime + deltaSeconds);

        private void Update() => Advance(Time.deltaTime);

        /// <summary>Moves truth time forward by one frame of playback. Public so tests can drive the clock.</summary>
        public void Advance(float deltaSeconds)
        {
            if (!IsPlaying || Scenario == null) return;

            var next = CurrentTime + deltaSeconds * PlaybackSpeed;
            var hold = FirstHoldReached(CurrentTime, next, Scenario.durationSeconds);
            var ended = false;
            if (hold.HasValue)
            {
                next = hold.Value;
            }
            else if (next >= Scenario.durationSeconds)
            {
                next = Scenario.durationSeconds;
                ended = true;
            }

            CurrentTime = next;
            sceneController.Evaluate(CurrentTime);
            TimeChanged?.Invoke(CurrentTime);

            if (hold.HasValue)
            {
                SetPlaying(false);
                HoldReached?.Invoke(CurrentTime);
            }
            else if (ended)
            {
                SetPlaying(false);
                Ended?.Invoke();
            }
        }

        // A hold point equal to `from` counts, so pressing play while resting on one stops again immediately.
        private float? FirstHoldReached(float from, float to, float duration)
        {
            foreach (var point in holdPoints)
            {
                if (point >= from && point < to && point < duration) return point;
            }
            return null;
        }

        private void SetPlaying(bool playing)
        {
            if (IsPlaying == playing) return;
            IsPlaying = playing;
            PlayingChanged?.Invoke(playing);
        }

        /// <summary>The semantic event currently "in effect" at `CurrentTime`
        /// — the most recent event whose own timestamp is at or before it.
        /// Pure lookup on the scenario's own event list, used only by the
        /// overlay to label what's on screen (req. 17) — never influences
        /// pose/camera evaluation itself.</summary>
        public ReconstructionEventData CurrentEvent()
        {
            if (Scenario == null) return null;
            ReconstructionEventData current = null;
            foreach (var e in Scenario.events)
            {
                if (e.time > CurrentTime) break;
                current = e;
            }
            return current;
        }
    }
}
