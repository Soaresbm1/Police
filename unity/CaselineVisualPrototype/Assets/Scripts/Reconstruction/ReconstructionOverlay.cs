using System.Collections.Generic;
using UnityEngine;

namespace Caseline.Reconstruction
{
    /// <summary>
    /// Phase U5.2 — the standalone POC's on-screen HUD: title, elapsed/total
    /// time, the current semantic event in neutral French, playback
    /// controls, a scrubber, and the mandatory visual disclaimer (req. 21).
    /// IMGUI, same cheap-and-simple choice `CCTVOverlay` already made for
    /// its own prototype — independently written, not shared code.
    /// </summary>
    public class ReconstructionOverlay : MonoBehaviour
    {
        [SerializeField] private ReconstructionPlaybackController playback;
        [SerializeField] private ReconstructionSceneController scene;

        /// <summary>Dev/Editor-only scenario switcher (req. 24) — never
        /// wired onto a production embed scene.</summary>
        [SerializeField] private ReconstructionSceneController sceneControllerForSwitcher;
        [SerializeField] private string[] scenarioFiles = System.Array.Empty<string>();
        [SerializeField] private string[] scenarioLabels = System.Array.Empty<string>();

        private static readonly Dictionary<string, string> RoleLabelsFrench = new()
        {
            ["victim"] = "VICTIME",
            ["culprit"] = "AUTEUR",
            ["accomplice"] = "COMPLICE",
            ["unnamed"] = "PERSONNE",
        };

        public void SetScene(ReconstructionSceneController sceneController) => scene = sceneController;

        private static readonly Dictionary<string, string> EventLabelsFrench = new()
        {
            ["meet"] = "RENCONTRE",
            ["talk"] = "DISCUSSION",
            ["attack"] = "AGRESSION",
            ["phone_use"] = "APPEL",
            ["leave_scene"] = "DÉPART",
            ["use_object"] = "OBJET",
            ["discover"] = "DÉCOUVERTE",
            ["stage_scene"] = "MISE EN SCÈNE",
        };

        private GUIStyle labelStyle;
        private GUIStyle titleStyle;
        private GUIStyle buttonStyle;
        private GUIStyle disclaimerStyle;

        public void SetScenarioSwitcher(ReconstructionSceneController controller, ReconstructionPlaybackController playbackController, string[] files, string[] labels)
        {
            sceneControllerForSwitcher = controller;
            playback = playbackController;
            scenarioFiles = files ?? System.Array.Empty<string>();
            scenarioLabels = labels ?? System.Array.Empty<string>();
        }

        private void OnGUI()
        {
            EnsureStyles();

            GUI.Label(new Rect(12, 8, 300, 28), "RECONSTITUTION", titleStyle);

            var total = playback != null && playback.Scenario != null ? playback.Scenario.durationSeconds : 0f;
            var current = playback != null ? playback.CurrentTime : 0f;
            GUI.Label(new Rect(12, 34, 300, 22), $"{FormatClock(current)} / {FormatClock(total)}", labelStyle);

            var currentEvent = playback != null ? playback.CurrentEvent() : null;
            if (currentEvent != null && EventLabelsFrench.TryGetValue(currentEvent.type, out var label))
            {
                GUI.Label(new Rect(12, 56, 300, 22), label, labelStyle);
            }

            // Req. 21 — makes the truth/cosmetic spatial boundary explicit
            // to whoever is watching, always visible, never hidden behind
            // an interaction.
            GUI.Label(new Rect(12, Screen.height - 96, 460, 20), "Reconstitution visuelle — positions spatiales indicatives", disclaimerStyle);

            DrawActorLabels();
            DrawScrubber();
            DrawControls();
            DrawScenarioSwitcher();
        }

        /// <summary>Neutral role labels above each visible actor (req. 9) —
        /// drawn purely from `roleForReconstruction`, which the projector
        /// already restricted to the already-shipped disclosure boundary
        /// (victim/culprit/accomplice named, everyone else "PERSONNE").
        /// Nothing here infers anything beyond what the scenario states.</summary>
        private void DrawActorLabels()
        {
            if (scene == null) return;
            var camera = scene.CurrentActiveCamera();
            if (camera == null) return;

            foreach (var actor in scene.SpawnedActors)
            {
                if (actor == null || !actor.gameObject.activeInHierarchy) continue;
                var worldPos = actor.transform.position + Vector3.up * 2.0f;
                var screenPos = camera.WorldToScreenPoint(worldPos);
                if (screenPos.z <= 0f) continue; // behind the camera — never draw

                var guiY = Screen.height - screenPos.y;
                var label = RoleLabelsFrench.TryGetValue(actor.Data.roleForReconstruction, out var text) ? text : "PERSONNE";
                var rect = new Rect(screenPos.x - 50f, guiY - 12f, 100f, 20f);
                GUI.Label(rect, label, labelStyle);
            }
        }

        private void DrawScrubber()
        {
            if (playback == null || playback.Scenario == null) return;
            var total = playback.Scenario.durationSeconds;
            if (total <= 0f) return;

            var rect = new Rect(12, Screen.height - 118, Screen.width - 24, 18);
            var newValue = GUI.HorizontalSlider(rect, playback.CurrentTime, 0f, total);
            if (!Mathf.Approximately(newValue, playback.CurrentTime))
            {
                playback.Seek(newValue);
            }
        }

        private void DrawControls()
        {
            const float w = 84f;
            const float h = 26f;
            var y = Screen.height - 70f;
            var x = 12f;

            if (GUI.Button(new Rect(x, y, w, h), playback != null && playback.IsPlaying ? "PAUSE" : "LECTURE", buttonStyle))
            {
                if (playback != null)
                {
                    if (playback.IsPlaying) playback.Pause();
                    else playback.Play();
                }
            }
            x += w + 6f;

            if (GUI.Button(new Rect(x, y, w, h), "RESTART", buttonStyle))
            {
                playback?.Restart();
            }
            x += w + 6f;

            if (GUI.Button(new Rect(x, y, 50f, h), "◀", buttonStyle))
            {
                playback?.Step(-1f);
            }
            x += 56f;

            if (GUI.Button(new Rect(x, y, 50f, h), "▶", buttonStyle))
            {
                playback?.Step(1f);
            }
            x += 56f;

            var speedLabel = playback != null ? $"{playback.PlaybackSpeed:0.0}×" : "1.0×";
            if (GUI.Button(new Rect(x, y, w, h), speedLabel, buttonStyle))
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

        private void DrawScenarioSwitcher()
        {
            if (sceneControllerForSwitcher == null || scenarioFiles.Length == 0) return;

            const float w = 150f;
            const float h = 22f;
            var x = 12f;
            var y = 84f;
            for (var i = 0; i < scenarioFiles.Length; i++)
            {
                var label = i < scenarioLabels.Length ? scenarioLabels[i] : scenarioFiles[i];
                if (GUI.Button(new Rect(x, y, w, h), label, buttonStyle))
                {
                    sceneControllerForSwitcher.LoadScenario(scenarioFiles[i]);
                }
                y += h + 4f;
            }
        }

        private void EnsureStyles()
        {
            if (labelStyle == null)
            {
                labelStyle = new GUIStyle(GUI.skin.label) { fontSize = 15, normal = { textColor = new Color(0.85f, 0.85f, 0.85f) } };
            }
            if (titleStyle == null)
            {
                titleStyle = new GUIStyle(GUI.skin.label) { fontSize = 18, fontStyle = FontStyle.Bold, normal = { textColor = Color.white } };
            }
            if (buttonStyle == null)
            {
                buttonStyle = new GUIStyle(GUI.skin.button) { fontSize = 13 };
            }
            if (disclaimerStyle == null)
            {
                disclaimerStyle = new GUIStyle(GUI.skin.label) { fontSize = 12, fontStyle = FontStyle.Italic, normal = { textColor = new Color(0.9f, 0.75f, 0.35f) } };
            }
        }

        private static string FormatClock(float seconds)
        {
            var s = Mathf.Max(0, Mathf.FloorToInt(seconds));
            var hh = s / 3600;
            var mm = (s / 60) % 60;
            var ss = s % 60;
            return $"{hh:00}:{mm:00}:{ss:00}";
        }
    }
}
