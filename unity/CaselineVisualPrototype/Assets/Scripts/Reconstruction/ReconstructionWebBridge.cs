using System.Collections;
using UnityEngine;

namespace Caseline.Reconstruction
{
    /// <summary>
    /// Host page ↔ reconstruction runtime bridge, reached with
    /// <c>unityInstance.SendMessage('ReconstructionWebBridge', method, message)</c>.
    ///
    /// Every command carries the token of the scenario load it belongs to (see <see cref="ReconstructionHostProtocol"/>).
    /// A command whose token is not the current load's, or that arrives before that load is ready, is ignored, so a
    /// late Seek from a previous scenario can never act on a new one. "ready" is emitted only after the scenario was
    /// parsed, validated and applied (environment and actors built, t=0 evaluated) and one frame has passed, so the
    /// previous scenario's destroyed objects are gone.
    ///
    /// Truth-safety: this class only parses and validates JSON through <see cref="ReconstructionJsonLoader"/>; it has
    /// no way to reach CaseTruth, and failures are reported as a neutral code, never the payload.
    /// </summary>
    public class ReconstructionWebBridge : MonoBehaviour
    {
        public const string InvalidScenario = "invalid_scenario";
        public const string MalformedCommand = "malformed_command";
        public const string BridgeUnavailable = "bridge_unavailable";

        private const float TimeEventIntervalSeconds = 0.1f;

        [SerializeField] private ReconstructionPlaybackController playback;

        private IReconstructionHostNotifier notifier = new WebGLReconstructionHostNotifier();
        private float lastTimeEventAt = float.NegativeInfinity;
        private bool subscribed;

        public int CurrentToken { get; private set; } = -1;
        public bool IsReady { get; private set; }

        public void Configure(ReconstructionPlaybackController playbackController)
        {
            Unsubscribe();
            playback = playbackController;
        }

        public void SetNotifier(IReconstructionHostNotifier hostNotifier)
        {
            notifier = hostNotifier ?? new WebGLReconstructionHostNotifier();
        }

        public void LoadScenario(string message)
        {
            if (!ReconstructionHostProtocol.TryParseTokenAndPayload(message, out var token, out var json))
            {
                notifier.Emit(ReconstructionHostEvents.LoadFailed, -1, MalformedCommand);
                return;
            }

            ResetSession();
            CurrentToken = token;

            if (playback == null)
            {
                notifier.Emit(ReconstructionHostEvents.LoadFailed, token, BridgeUnavailable);
                return;
            }

            if (!ReconstructionJsonLoader.TryLoad(json, out var scenario, out _))
            {
                notifier.Emit(ReconstructionHostEvents.LoadFailed, token, InvalidScenario);
                return;
            }

            Subscribe();
            playback.Load(scenario);
            if (Application.isPlaying && isActiveAndEnabled) StartCoroutine(ReadyAfterFrame(token));
        }

        private IEnumerator ReadyAfterFrame(int token)
        {
            yield return null;
            NotifyReadyIfCurrent(token);
        }

        public void NotifyReadyIfCurrent(int token)
        {
            if (IsReady || token != CurrentToken || playback == null || playback.Scenario == null) return;
            IsReady = true;
            notifier.Emit(ReconstructionHostEvents.Ready, token, ReconstructionHostProtocol.FormatNumber(playback.Scenario.durationSeconds));
        }

        /// <summary>Forgets the current load: its token stops matching and no further events are sent for it.</summary>
        public void ResetSession()
        {
            StopAllCoroutines();
            CurrentToken = -1;
            IsReady = false;
            lastTimeEventAt = float.NegativeInfinity;
            if (playback != null)
            {
                playback.Pause();
                playback.SetHoldPoints(null);
            }
        }

        public void Play(string message)
        {
            if (TryCurrent(message, out _)) playback.Play();
        }

        public void Pause(string message)
        {
            if (TryCurrent(message, out _)) playback.Pause();
        }

        public void Restart(string message)
        {
            if (TryCurrent(message, out _)) playback.Restart();
        }

        public void Seek(string message)
        {
            if (TryCurrent(message, out var payload) && ReconstructionHostProtocol.TryParseFloat(payload, out var time)) playback.Seek(time);
        }

        public void SetSpeed(string message)
        {
            if (TryCurrent(message, out var payload) && ReconstructionHostProtocol.TryParseFloat(payload, out var speed) && speed > 0f) playback.SetSpeed(speed);
        }

        public void SetHoldPoints(string message)
        {
            if (TryCurrent(message, out var payload)) playback.SetHoldPoints(ReconstructionHostProtocol.ParseFloatList(payload));
        }

        private bool TryCurrent(string message, out string payload)
        {
            payload = string.Empty;
            return IsReady
                && playback != null
                && ReconstructionHostProtocol.TryParseTokenAndPayload(message, out var token, out payload)
                && token == CurrentToken;
        }

        private void Subscribe()
        {
            if (subscribed || playback == null) return;
            playback.TimeChanged += OnTimeChanged;
            playback.PlayingChanged += OnPlayingChanged;
            playback.HoldReached += OnHoldReached;
            playback.Ended += OnEnded;
            subscribed = true;
        }

        private void Unsubscribe()
        {
            if (!subscribed || playback == null) return;
            playback.TimeChanged -= OnTimeChanged;
            playback.PlayingChanged -= OnPlayingChanged;
            playback.HoldReached -= OnHoldReached;
            playback.Ended -= OnEnded;
            subscribed = false;
        }

        private void OnDestroy() => Unsubscribe();

        private void OnTimeChanged(float time)
        {
            if (!IsReady) return;
            var now = Time.unscaledTime;
            if (playback.IsPlaying && now - lastTimeEventAt < TimeEventIntervalSeconds) return;
            lastTimeEventAt = now;
            notifier.Emit(ReconstructionHostEvents.Time, CurrentToken, ReconstructionHostProtocol.FormatTime(time, playback.IsPlaying));
        }

        private void OnPlayingChanged(bool playing)
        {
            if (!IsReady) return;
            lastTimeEventAt = Time.unscaledTime;
            notifier.Emit(ReconstructionHostEvents.Time, CurrentToken, ReconstructionHostProtocol.FormatTime(playback.CurrentTime, playing));
        }

        private void OnHoldReached(float time)
        {
            if (IsReady) notifier.Emit(ReconstructionHostEvents.Hold, CurrentToken, ReconstructionHostProtocol.FormatNumber(time));
        }

        private void OnEnded()
        {
            if (IsReady) notifier.Emit(ReconstructionHostEvents.Ended, CurrentToken, ReconstructionHostProtocol.FormatNumber(playback.CurrentTime));
        }
    }
}
