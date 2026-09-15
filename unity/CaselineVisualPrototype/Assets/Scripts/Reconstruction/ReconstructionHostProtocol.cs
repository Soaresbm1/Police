using System.Collections.Generic;
using System.Globalization;
using System.Runtime.InteropServices;
using UnityEngine;

namespace Caseline.Reconstruction
{
    /// <summary>Event names Unity sends to the host page. Mirrored in lib/art/reconstruction-session.ts.</summary>
    public static class ReconstructionHostEvents
    {
        public const string Ready = "ready";
        public const string LoadFailed = "load_failed";
        public const string Time = "time";
        public const string Hold = "hold";
        public const string Ended = "ended";
    }

    public interface IReconstructionHostNotifier
    {
        void Emit(string eventType, int token, string detail);
    }

    /// <summary>Delivers events to the page through CaselineReconstructionBridge.jslib; logs instead outside WebGL builds.</summary>
    public sealed class WebGLReconstructionHostNotifier : IReconstructionHostNotifier
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")]
        private static extern void CaselineReconstructionEmit(string eventType, int token, string detail);

        public void Emit(string eventType, int token, string detail) => CaselineReconstructionEmit(eventType, token, detail ?? string.Empty);
#else
        public void Emit(string eventType, int token, string detail) => Debug.Log($"[Reconstruction] host event {eventType} token={token} {detail}");
#endif
    }

    /// <summary>
    /// Wire format for host → Unity commands. SendMessage carries a single string, so every command is
    /// "&lt;token&gt;" or "&lt;token&gt;:&lt;payload&gt;", where the token identifies the scenario load it belongs to.
    /// </summary>
    public static class ReconstructionHostProtocol
    {
        public static bool TryParseTokenAndPayload(string message, out int token, out string payload)
        {
            token = -1;
            payload = string.Empty;
            if (string.IsNullOrEmpty(message)) return false;

            var separator = message.IndexOf(':');
            var tokenText = separator < 0 ? message : message.Substring(0, separator);
            if (!int.TryParse(tokenText, NumberStyles.None, CultureInfo.InvariantCulture, out token) || token < 0)
            {
                token = -1;
                return false;
            }
            payload = separator < 0 ? string.Empty : message.Substring(separator + 1);
            return true;
        }

        public static bool TryParseFloat(string text, out float value)
        {
            return float.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out value) && !float.IsNaN(value) && !float.IsInfinity(value);
        }

        public static List<float> ParseFloatList(string text)
        {
            var values = new List<float>();
            if (string.IsNullOrEmpty(text)) return values;
            foreach (var part in text.Split(','))
            {
                if (TryParseFloat(part, out var value)) values.Add(value);
            }
            return values;
        }

        public static string FormatNumber(float value) => value.ToString("0.###", CultureInfo.InvariantCulture);

        public static string FormatTime(float time, bool playing) => $"{FormatNumber(time)}|{(playing ? 1 : 0)}";
    }
}
