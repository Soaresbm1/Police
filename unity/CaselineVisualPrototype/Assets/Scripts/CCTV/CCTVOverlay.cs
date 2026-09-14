using UnityEngine;

namespace Caseline.CCTV
{
    /// <summary>
    /// The fixed-on-screen CCTV HUD (camera id / REC / timestamp) plus the
    /// demo's Play/Pause/Restart/speed controls (Phase U1, req. 10/12).
    /// Uses IMGUI (`OnGUI`) rather than a Canvas/UI hierarchy — for a
    /// proof-of-concept this is the cheapest way to get reliable on-screen
    /// text and buttons without hand-building a UI prefab, and it keeps
    /// this concern in exactly one small, separate script rather than
    /// folded into the scene controller (req. 14: no giant MonoBehaviour).
    /// A small procedurally-built vignette texture gives a restrained
    /// CCTV corner-darkening look — the only visual "treatment" this
    /// prototype spends time on, per the brief's "do not waste time on
    /// advanced shaders" instruction.
    /// </summary>
    public class CCTVOverlay : MonoBehaviour
    {
        [SerializeField] private CCTVPlaybackController playback;
        [SerializeField] private string cameraId = "CAM-01";

        /// <summary>Visual-QA-only scenario switcher (Phase U2, req. 22) —
        /// a fixed list of StreamingAssets filenames with a short on-screen
        /// label each, so several exported real CASELINE cases can be
        /// inspected without leaving Play Mode. Empty by default (the
        /// baseline Phase U1 demo has nothing to switch between).</summary>
        [SerializeField] private CCTVSceneController sceneController;
        [SerializeField] private string[] scenarioFiles = System.Array.Empty<string>();
        [SerializeField] private string[] scenarioLabels = System.Array.Empty<string>();

        private Texture2D vignetteTexture;
        private GUIStyle labelStyle;
        private GUIStyle buttonStyle;

        private void Awake()
        {
            vignetteTexture = BuildVignetteTexture(128);
        }

        public void SetCameraId(string id) => cameraId = id;

        /// <summary>Configures the scenario switcher row — called by
        /// whatever sets up the visual-QA scene, never by production
        /// scenario data itself.</summary>
        public void SetScenarioSwitcher(CCTVSceneController controller, string[] files, string[] labels)
        {
            sceneController = controller;
            scenarioFiles = files ?? System.Array.Empty<string>();
            scenarioLabels = labels ?? System.Array.Empty<string>();
        }

        private void OnGUI()
        {
            EnsureStyles();

            if (vignetteTexture != null)
            {
                var prevColor = GUI.color;
                GUI.color = new Color(1f, 1f, 1f, 1f);
                GUI.DrawTexture(new Rect(0, 0, Screen.width, Screen.height), vignetteTexture, ScaleMode.StretchToFill);
                GUI.color = prevColor;
            }

            GUI.Label(new Rect(12, 10, 200, 24), cameraId, labelStyle);

            var recBlink = Mathf.PingPong(Time.unscaledTime, 1f) > 0.5f;
            var recColor = recBlink ? new Color(0.86f, 0.2f, 0.2f) : new Color(0.5f, 0.12f, 0.12f);
            var prevContentColor = GUI.contentColor;
            GUI.contentColor = recColor;
            GUI.Label(new Rect(Screen.width - 90, 10, 80, 24), "REC ●", labelStyle);
            GUI.contentColor = prevContentColor;

            var currentTime = playback != null ? playback.CurrentTime : 0f;
            GUI.Label(new Rect(12, Screen.height - 34, 200, 24), FormatClock(currentTime), labelStyle);

            DrawControls();
            DrawScenarioSwitcher();
        }

        private void DrawScenarioSwitcher()
        {
            if (sceneController == null || scenarioFiles.Length == 0) return;

            const float w = 130f;
            const float h = 22f;
            var x = 12f;
            var y = 42f;
            for (var i = 0; i < scenarioFiles.Length; i++)
            {
                var label = i < scenarioLabels.Length ? scenarioLabels[i] : scenarioFiles[i];
                if (GUI.Button(new Rect(x, y, w, h), label, buttonStyle))
                {
                    sceneController.LoadScenario(scenarioFiles[i]);
                }
                x += w + 6f;
            }
        }

        private void DrawControls()
        {
            const float w = 90f;
            const float h = 26f;
            var y = Screen.height - 70f;

            if (GUI.Button(new Rect(12, y, w, h), playback != null && playback.IsPlaying ? "PAUSE" : "PLAY", buttonStyle))
            {
                if (playback != null)
                {
                    if (playback.IsPlaying) playback.Pause();
                    else playback.Play();
                }
            }

            if (GUI.Button(new Rect(12 + w + 8, y, w, h), "RESTART", buttonStyle))
            {
                playback?.Restart();
            }

            var speedLabel = playback != null ? $"{playback.PlaybackSpeed:0.0}×" : "1.0×";
            if (GUI.Button(new Rect(12 + (w + 8) * 2, y, w, h), speedLabel, buttonStyle))
            {
                if (playback != null)
                {
                    var next = Mathf.Approximately(playback.PlaybackSpeed, 1f) ? 2f
                        : Mathf.Approximately(playback.PlaybackSpeed, 2f) ? 0.5f
                        : 1f;
                    playback.SetSpeed(next);
                }
            }
        }

        private void EnsureStyles()
        {
            if (labelStyle == null)
            {
                labelStyle = new GUIStyle(GUI.skin.label)
                {
                    fontSize = 16,
                    normal = { textColor = new Color(0.79f, 0.64f, 0.24f) },
                };
            }
            if (buttonStyle == null)
            {
                buttonStyle = new GUIStyle(GUI.skin.button) { fontSize = 14 };
            }
        }

        private static string FormatClock(float seconds)
        {
            var s = Mathf.Max(0, Mathf.FloorToInt(seconds));
            var hh = (s / 3600) % 24;
            var mm = (s / 60) % 60;
            var ss = s % 60;
            return $"{hh:00}:{mm:00}:{ss:00}";
        }

        /// <summary>A small radial-alpha texture, corners darker than the
        /// center — sampled once at startup and stretched over the screen
        /// every frame, far cheaper than a per-pixel shader for a
        /// proof-of-concept's "restrained vignette" requirement.</summary>
        private static Texture2D BuildVignetteTexture(int size)
        {
            var tex = new Texture2D(size, size, TextureFormat.RGBA32, false)
            {
                wrapMode = TextureWrapMode.Clamp,
                filterMode = FilterMode.Bilinear,
            };
            var center = new Vector2(size / 2f, size / 2f);
            var maxDist = center.magnitude;
            for (var y = 0; y < size; y++)
            {
                for (var x = 0; x < size; x++)
                {
                    var dist = Vector2.Distance(new Vector2(x, y), center) / maxDist;
                    var alpha = Mathf.Clamp01(Mathf.InverseLerp(0.55f, 1f, dist)) * 0.35f;
                    tex.SetPixel(x, y, new Color(0f, 0f, 0f, alpha));
                }
            }
            tex.Apply();
            return tex;
        }
    }
}
