using System;
using System.Collections.Generic;
using System.Linq;
using Caseline.Reconstruction;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.Rendering;

namespace Caseline.Reconstruction.Tests
{
    /// <summary>
    /// The reconstruction's moods (lighting, ambient, sky, vignette, focus light). They are presentation only and a pure
    /// function of the camera mode the director already chose, so they must stay deterministic, truth-safe and — for
    /// every beat except the discovery — exactly the lighting the reconstruction has always had.
    /// </summary>
    public class ReconstructionAtmosphereTests
    {
        private readonly List<UnityEngine.Object> created = new();
        private Color previousAmbient;
        private AmbientMode previousAmbientMode;

        [SetUp]
        public void SetUp()
        {
            previousAmbient = RenderSettings.ambientLight;
            previousAmbientMode = RenderSettings.ambientMode;
        }

        [TearDown]
        public void TearDown()
        {
            foreach (var o in created) if (o != null) UnityEngine.Object.DestroyImmediate(o);
            created.Clear();
            RenderSettings.ambientMode = previousAmbientMode;
            RenderSettings.ambientLight = previousAmbient;
        }

        private T Track<T>(T o) where T : UnityEngine.Object
        {
            created.Add(o);
            return o;
        }

        private static float Luminance(Color c) => 0.2126f * c.r + 0.7152f * c.g + 0.0722f * c.b;

        private static IEnumerable<ReconstructionCameraMode> Modes => (ReconstructionCameraMode[])Enum.GetValues(typeof(ReconstructionCameraMode));

        [Test]
        public void Mood_IsAPureFunctionOfTheCameraModeOnly_NothingFromTheCaseCanReachIt()
        {
            var method = typeof(ReconstructionAtmosphere).GetMethod(nameof(ReconstructionAtmosphere.For));
            CollectionAssert.AreEqual(new[] { typeof(ReconstructionCameraMode) }, method.GetParameters().Select(p => p.ParameterType).ToArray(), "no scenario, role, time or identity parameter");
            foreach (var mode in Modes)
            {
                var a = ReconstructionAtmosphere.For(mode);
                var b = ReconstructionAtmosphere.For(mode);
                Assert.AreEqual(a.LightIntensity, b.LightIntensity, mode.ToString());
                Assert.AreEqual(a.Ambient, b.Ambient, mode.ToString());
                Assert.AreEqual(a.Vignette, b.Vignette, mode.ToString());
                Assert.AreEqual(a.LightRotation, b.LightRotation, mode.ToString());
            }
        }

        [Test]
        public void EveryBeatExceptTheDiscovery_KeepsTheLightingTheReconstructionHasAlwaysHad()
        {
            foreach (var mode in Modes.Where(m => m != ReconstructionCameraMode.Discovery))
            {
                var mood = ReconstructionAtmosphere.For(mode);
                Assert.AreEqual(new Color(0.98f, 0.96f, 0.9f), mood.LightColor, $"{mode}: key light colour (U5.2)");
                Assert.AreEqual(1.1f, mood.LightIntensity, $"{mode}: key light intensity (U5.2)");
                Assert.AreEqual(55f, mood.LightPitchDegrees, $"{mode}: key light pitch (U5.2)");
                Assert.AreEqual(-30f, mood.LightYawDegrees, $"{mode}: key light yaw (U5.2)");
                Assert.AreEqual(new Color(0.2f, 0.2f, 0.22f), mood.Ambient, $"{mode}: ambient (U5.2)");
                Assert.IsFalse(mood.SolidSky, $"{mode}: keeps the scene's own sky");
                Assert.AreEqual(0f, mood.FocusIntensity, $"{mode}: no focus light");
            }
        }

        [Test]
        public void OnlyTheDiscoveryGetsTheAftermathMood()
        {
            foreach (var mode in Modes)
            {
                var mood = ReconstructionAtmosphere.For(mode);
                var aftermath = mode == ReconstructionCameraMode.Discovery;
                Assert.AreEqual(aftermath, mood.SolidSky, mode.ToString());
                Assert.AreEqual(aftermath, mood.FocusIntensity > 0f, mode.ToString());
                Assert.AreEqual(aftermath, mood.Vignette > ReconstructionAtmosphere.Standard.Vignette, mode.ToString());
            }
        }

        [Test]
        public void Aftermath_KeepsTheKeyLightYaw_SoTheLitSideTheCamerasStandOnIsUnchanged()
        {
            Assert.AreEqual(ReconstructionAtmosphere.Standard.LightYawDegrees, ReconstructionAtmosphere.Aftermath.LightYawDegrees);
            Assert.Less(ReconstructionAtmosphere.Aftermath.LightPitchDegrees, ReconstructionAtmosphere.Standard.LightPitchDegrees, "a lower light, so shadows reach further across the floor");
        }

        [Test]
        public void Aftermath_LightStaysNearNeutral_SoTheEnvironmentPaletteKeepsItsHuesAndTheFiguresTheirContrast()
        {
            var c = ReconstructionAtmosphere.Aftermath.LightColor;
            Assert.LessOrEqual(Mathf.Max(c.r, c.g, c.b) - Mathf.Min(c.r, c.g, c.b), 0.06f, "a tinted light would erase the floor(cool)/wall(warm) separation");
            var focus = ReconstructionAtmosphere.Aftermath.FocusColor;
            Assert.LessOrEqual(Mathf.Max(focus.r, focus.g, focus.b) - Mathf.Min(focus.r, focus.g, focus.b), 0.1f);
        }

        [Test]
        public void EveryMood_StaysInSafeRanges_FiguresAreNeverLostInTheDark()
        {
            foreach (var mode in Modes)
            {
                var mood = ReconstructionAtmosphere.For(mode);
                Assert.That(mood.ShadowStrength, Is.InRange(0.3f, 0.9f), $"{mode}: shadows soft, never black");
                Assert.That(mood.Vignette, Is.InRange(0f, 0.5f), $"{mode}: edges darkened, never blacked out");
                Assert.GreaterOrEqual(mood.LightIntensity, 0.7f, $"{mode}: key light");
                Assert.GreaterOrEqual(Luminance(mood.Ambient), 0.12f, $"{mode}: ambient fill");
                Assert.LessOrEqual(mood.FocusIntensity, 3f, $"{mode}: the focus pool must not blow out the figures");
                Assert.That(mood.LightPitchDegrees, Is.InRange(25f, 80f), $"{mode}: pitch");
            }
        }

        [Test]
        public void Vignette_IsClearInTheMiddle_AndDarkensSmoothlyTowardTheCorners()
        {
            Assert.AreEqual(0f, ReconstructionAtmosphere.VignetteAlpha(0f, 0f));
            Assert.AreEqual(0f, ReconstructionAtmosphere.VignetteAlpha(0.3f, 0.3f), 1e-6f, "the centre of the frame is untouched");
            var previous = -1f;
            for (var i = 0; i <= 20; i++)
            {
                var t = i / 20f;
                var alpha = ReconstructionAtmosphere.VignetteAlpha(t, t);
                Assert.GreaterOrEqual(alpha, previous - 1e-6f, $"monotonic at {t}");
                Assert.That(alpha, Is.InRange(0f, 1f));
                previous = alpha;
            }
            Assert.Greater(ReconstructionAtmosphere.VignetteAlpha(1f, 1f), ReconstructionAtmosphere.VignetteAlpha(1f, 0f), "corners darker than edge midpoints");
            Assert.Greater(ReconstructionAtmosphere.VignetteAlpha(1f, 1f), 0.9f);
            Assert.AreEqual(ReconstructionAtmosphere.VignetteAlpha(0.7f, -0.4f), ReconstructionAtmosphere.VignetteAlpha(-0.7f, 0.4f), "symmetric");
        }

        private (ReconstructionAtmosphereController controller, Light key, Light focus, Camera overview, Camera close) MakeRig()
        {
            var key = Track(new GameObject("TestKeyLight")).AddComponent<Light>();
            key.type = LightType.Directional;
            var focus = Track(new GameObject("TestFocusLight")).AddComponent<Light>();
            focus.type = LightType.Spot;
            focus.enabled = false;
            var overview = Track(new GameObject("TestOverview")).AddComponent<Camera>();
            var close = Track(new GameObject("TestClose")).AddComponent<Camera>();
            var controller = key.gameObject.AddComponent<ReconstructionAtmosphereController>();
            controller.Configure(key, focus, overview, close);
            return (controller, key, focus, overview, close);
        }

        [Test]
        public void Apply_DrivesTheKeyLight_TheFocusLight_TheAmbientAndTheSky()
        {
            var (controller, key, focus, overview, close) = MakeRig();
            var slot = new Vector3(2f, 0f, 3f);

            controller.Apply(ReconstructionCameraMode.Discovery, slot);
            var aftermath = ReconstructionAtmosphere.Aftermath;
            Assert.AreEqual(aftermath.LightIntensity, key.intensity, 1e-5f);
            Assert.AreEqual(aftermath.LightColor, key.color);
            Assert.AreEqual(LightShadows.Soft, key.shadows);
            Assert.AreEqual(aftermath.ShadowStrength, key.shadowStrength, 1e-5f);
            Assert.Less(Quaternion.Angle(aftermath.LightRotation, key.transform.rotation), 1e-2f);
            Assert.AreEqual(aftermath.Ambient, RenderSettings.ambientLight);
            Assert.IsTrue(focus.enabled, "the focus pool is on for the discovery");
            Assert.AreEqual(aftermath.FocusIntensity, focus.intensity, 1e-5f);
            Assert.Less(Vector3.Distance(slot + ReconstructionAtmosphereController.FocusLightOffset, focus.transform.position), 1e-4f, "a fixed offset from the slot");
            foreach (var camera in new[] { overview, close })
            {
                Assert.AreEqual(CameraClearFlags.SolidColor, camera.clearFlags);
                Assert.AreEqual(aftermath.Sky, camera.backgroundColor);
            }

            controller.Apply(ReconstructionCameraMode.PhysicalAttack, Vector3.zero);
            Assert.AreEqual(ReconstructionAtmosphere.Standard.LightIntensity, key.intensity, 1e-5f);
            Assert.AreEqual(ReconstructionAtmosphere.Standard.Ambient, RenderSettings.ambientLight);
            Assert.IsFalse(focus.enabled, "no focus pool outside the discovery");
            foreach (var camera in new[] { overview, close }) Assert.AreEqual(CameraClearFlags.Skybox, camera.clearFlags);
        }

        [Test]
        public void FocusLight_SameSlotAlwaysGivesTheSamePosition()
        {
            var (controller, _, focus, _, _) = MakeRig();
            controller.Apply(ReconstructionCameraMode.Discovery, new Vector3(1.5f, 0f, -0.5f));
            var first = focus.transform.position;
            controller.Apply(ReconstructionCameraMode.Overview, Vector3.zero);
            controller.Apply(ReconstructionCameraMode.Discovery, new Vector3(1.5f, 0f, -0.5f));
            Assert.AreEqual(first, focus.transform.position);
        }

        [Test]
        public void Environment_OnlyReceivesShadows_ThePeopleAreTheOnlyThingsThatCastThem()
        {
            var shader = Shader.Find("Standard");
            Assert.IsNotNull(shader);
            var floor = Track(new Material(shader));
            var wall = Track(new Material(shader));
            var prop = Track(new Material(shader));
            var zone = Track(new Material(shader));
            var go = Track(new GameObject("EnvShadowProbe"));
            var controller = go.AddComponent<ReconstructionEnvironmentController>();
            foreach (var env in ReconstructionSchema.EnvironmentKinds)
            {
                controller.Build(env, floor, wall, prop, zone);
                var renderers = go.GetComponentsInChildren<MeshRenderer>();
                Assert.Greater(renderers.Length, 0, env);
                foreach (var renderer in renderers)
                {
                    Assert.AreEqual(ShadowCastingMode.Off, renderer.shadowCastingMode, $"{env}/{renderer.name}: scenery casting shadows paints hard-edged dark patches across the floor");
                    Assert.IsTrue(renderer.receiveShadows, $"{env}/{renderer.name}: scenery still receives the people's shadows");
                }
            }
        }

        private static ReconstructionScenarioData MakeScenario()
        {
            return new ReconstructionScenarioData
            {
                version = 1,
                caseId = "case-1",
                environment = "generic",
                durationSeconds = 200,
                actors = new List<ReconstructionActorData>(),
                events = new List<ReconstructionEventData>
                {
                    new() { time = 0, type = "talk", actorVisualId = "a", counterpartyVisualId = "b", locationSlot = "interaction" },
                    new() { time = 20, type = "attack", actorVisualId = "a", counterpartyVisualId = "b", locationSlot = "crime_point", safeVisualAction = "attack_strike" },
                    new() { time = 40, type = "leave_scene", actorVisualId = "a", locationSlot = "exit" },
                    new() { time = 150, type = "discover", actorVisualId = "c", locationSlot = "crime_point" },
                },
            };
        }

        private (ReconstructionSceneController scene, ReconstructionAtmosphereController atmosphere, Light focus) MakeScene()
        {
            var (atmosphere, _, focus, overview, close) = MakeRig();
            var cameraRig = Track(new GameObject("TestCameraRig")).AddComponent<ReconstructionCameraController>();
            cameraRig.Configure(overview, close);
            var scene = Track(new GameObject("TestScene")).AddComponent<ReconstructionSceneController>();
            scene.Configure(null, null, cameraRig, null, null, null, null, null);
            scene.SetAtmosphere(atmosphere);
            return (scene, atmosphere, focus);
        }

        [Test]
        public void Scene_AppliesTheAftermathOnlyWhileTheDiscoveryShotIsOnScreen_AndTheFocusSitsOverItsSlot()
        {
            var (scene, atmosphere, focus) = MakeScene();
            scene.ApplyScenario(MakeScenario());

            foreach (var t in new[] { 5f, 21f, 45f })
            {
                scene.Evaluate(t);
                Assert.AreEqual(ReconstructionAtmosphere.Standard.LightIntensity, atmosphere.Current.LightIntensity, $"t={t}");
                Assert.IsFalse(atmosphere.Current.SolidSky, $"t={t}");
                Assert.IsFalse(focus.enabled, $"t={t}");
            }

            scene.Evaluate(151f);
            Assert.AreEqual(ReconstructionAtmosphere.Aftermath.LightIntensity, atmosphere.Current.LightIntensity);
            Assert.AreEqual(ReconstructionAtmosphere.Aftermath.Vignette, scene.CurrentMood.Vignette);
            Assert.IsTrue(focus.enabled);
            var slot = ReconstructionZoneLayout.GetZonePosition("generic", "crime_point");
            Assert.Less(Vector3.Distance(slot + ReconstructionAtmosphereController.FocusLightOffset, focus.transform.position), 1e-4f, "the focus pool sits over the slot the camera aims at");
        }

        [Test]
        public void Scene_MoodIsSeekSafe_SameTimeSameMood_WhateverTheSeekHistory()
        {
            var (scene, atmosphere, focus) = MakeScene();
            scene.ApplyScenario(MakeScenario());

            scene.Evaluate(151f);
            var discoveryPosition = focus.transform.position;
            scene.Evaluate(21f);
            Assert.IsFalse(focus.enabled, "seeking back to the attack drops the aftermath");
            Assert.AreEqual(ReconstructionAtmosphere.Standard.LightIntensity, atmosphere.Current.LightIntensity);
            scene.Evaluate(160f);
            Assert.IsTrue(focus.enabled);
            Assert.AreEqual(discoveryPosition, focus.transform.position, "seeking forward again gives the same pool");
        }
    }
}
