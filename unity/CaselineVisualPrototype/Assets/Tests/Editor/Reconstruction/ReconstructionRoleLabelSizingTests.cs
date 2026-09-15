using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;
using static Caseline.Reconstruction.ReconstructionLabelLayout;

namespace Caseline.Reconstruction.Tests
{
    /// <summary>
    /// U5.3.1 regression tests for role-label truncation (COMPLICE drawn as "COMPLIC", PERSONNE as "PERSONN").
    /// Text is measured with IMGUI's own layout (CalcSize / CalcHeight) using the runtime Game skin, in the Editor.
    /// This is layout-level verification, not a pixel capture of the WebGL player.
    /// </summary>
    public class ReconstructionRoleLabelSizingTests
    {
        private static readonly string[] AllRoleLabels = { "VICTIME", "AUTEUR", "COMPLICE", "PERSONNE" };

        private GUIStyle style;

        [SetUp]
        public void CreateRuntimeLabelStyle()
        {
            style = ReconstructionOverlay.CreateLabelStyle(EditorGUIUtility.GetBuiltinSkin(EditorSkin.Game).label);
        }

        [Test]
        public void TheFourRoleLabels_AreExactlyTheOnesTheOverlayDraws()
        {
            CollectionAssert.AreEquivalent(AllRoleLabels, ReconstructionOverlay.RoleLabelTexts.ToArray());
        }

        [Test]
        public void LabelStyle_NeitherWrapsNorClips()
        {
            Assert.IsFalse(style.wordWrap);
            Assert.AreEqual(TextClipping.Overflow, style.clipping);
            Assert.IsFalse(ReconstructionOverlay.CreateLabelShadowStyle(style).wordWrap, "the shadow copy inherits it");
        }

        [TestCaseSource(nameof(AllRoleLabels))]
        public void Rect_FitsTheFullMeasuredText_WithPaddingOnBothSides_AndRoomForTheShadow(string text)
        {
            var measured = style.CalcSize(new GUIContent(text));
            var rect = LabelRect(measured, 400.37f, 300.61f);

            Assert.GreaterOrEqual(rect.width - 2f * LabelPaddingX - ShadowOffset, measured.x, "usable text width after padding and shadow");
            Assert.GreaterOrEqual(rect.height - ShadowOffset, measured.y);
        }

        [TestCaseSource(nameof(AllRoleLabels))]
        public void FullText_LaysOutOnOneLine_AtTheAllocatedWidth_AndEvenBelowTheMeasuredWidth(string text)
        {
            var content = new GUIContent(text);
            var measured = style.CalcSize(content);

            Assert.AreEqual(measured.y, style.CalcHeight(content, LabelRect(measured, 0f, 0f).width), 0.01f);
            Assert.AreEqual(measured.y, style.CalcHeight(content, Mathf.Floor(measured.x) - 1f), 0.01f,
                "a rect snapped narrower than the text must not push the last letter onto a second line");
        }

        [TestCaseSource(nameof(AllRoleLabels))]
        public void Rect_IsCentredOnItsActor_WithItsBottomAtTheAnchor_OnWholePixels(string text)
        {
            var rect = LabelRect(style.CalcSize(new GUIContent(text)), 400.37f, 300.61f);

            Assert.AreEqual(400.37f, rect.center.x, 0.51f);
            Assert.AreEqual(300.61f, rect.yMax, 0.51f);
            Assert.AreEqual(Mathf.Round(rect.x), rect.x);
            Assert.AreEqual(Mathf.Round(rect.y), rect.y);
        }

        [TestCase("VICTIME", "PERSONNE")]
        [TestCase("VICTIME", "COMPLICE")]
        [TestCase("VICTIME", "AUTEUR")]
        [TestCase("VICTIME", "AUTEUR", "COMPLICE")]
        [TestCase("VICTIME", "COMPLICE", "PERSONNE")]
        public void NearbyRoleLabels_DoNotOverlap_StayOnTheirOwnActor_AndPlaceDeterministically(params string[] texts)
        {
            // Actors a body-length apart at the same head height, as at a discovery beside the victim.
            var requests = texts.Select((text, i) =>
                new LabelRequest($"actor_{i}", LabelRect(style.CalcSize(new GUIContent(text)), 300f + 18f * i, 200f))).ToArray();
            var lane = LaneStep(requests);
            var placed = Resolve(requests, lane);

            for (var i = 0; i < placed.Length; i++)
            {
                Assert.AreEqual(requests[i].Rect.x, placed[i].x, $"{texts[i]} stays centred on its own actor");
                Assert.AreEqual(requests[i].Rect.size, placed[i].size, $"{texts[i]} keeps its full size");
                for (var j = i + 1; j < placed.Length; j++)
                {
                    Assert.IsFalse(placed[i].Overlaps(placed[j]), $"{texts[i]} overlaps {texts[j]}");
                }
            }

            CollectionAssert.AreEqual(placed, Resolve(requests, lane), "same input, same placement");
            var reversedRequests = Enumerable.Reverse(requests).ToArray();
            var reversed = Resolve(reversedRequests, lane);
            var byKey = new Dictionary<string, Rect>();
            for (var i = 0; i < reversedRequests.Length; i++) byKey[reversedRequests[i].Key] = reversed[i];
            for (var i = 0; i < requests.Length; i++) Assert.AreEqual(placed[i], byKey[requests[i].Key], "independent of actor order");
        }

        [Test]
        public void LaneStep_ClearsTheTallestLabelInOneStep()
        {
            var requests = AllRoleLabels.Select(text => new LabelRequest(text, LabelRect(style.CalcSize(new GUIContent(text)), 100f, 100f))).ToArray();
            Assert.Greater(LaneStep(requests), requests.Max(r => r.Rect.height));
        }
    }
}
