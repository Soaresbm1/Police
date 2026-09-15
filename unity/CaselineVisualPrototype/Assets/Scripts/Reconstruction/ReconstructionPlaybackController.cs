using System;
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

        public ReconstructionScenarioData Scenario => sceneController != null ? sceneController.Scenario : null;
        public float CurrentTime { get; private set; }
        public bool IsPlaying { get; private set; }
        public float PlaybackSpeed { get; private set; } = 1f;

        public event Action<float> TimeChanged;

        public void Configure(ReconstructionSceneController scene)
        {
            sceneController = scene;
        }

        public void Load(ReconstructionScenarioData scenario)
        {
            sceneController.ApplyScenario(scenario);
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
            sceneController.Evaluate(CurrentTime);
            TimeChanged?.Invoke(CurrentTime);
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
            sceneController.Evaluate(CurrentTime);
            TimeChanged?.Invoke(CurrentTime);
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
