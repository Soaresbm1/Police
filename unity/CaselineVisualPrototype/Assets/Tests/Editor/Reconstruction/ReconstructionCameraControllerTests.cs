using System.Collections.Generic;
using Caseline.Reconstruction;
using NUnit.Framework;

namespace Caseline.Reconstruction.Tests
{
    public class ReconstructionCameraControllerTests
    {
        private static ReconstructionScenarioData MakeScenario()
        {
            return new ReconstructionScenarioData
            {
                version = 1,
                caseId = "case-1",
                environment = "generic",
                durationSeconds = 100,
                actors = new List<ReconstructionActorData>(),
                events = new List<ReconstructionEventData>
                {
                    new() { time = 0, type = "meet", actorVisualId = "a", locationSlot = "entrance" },
                    new() { time = 10, type = "talk", actorVisualId = "a", locationSlot = "interaction" },
                    new() { time = 20, type = "attack", actorVisualId = "a", locationSlot = "crime_point" },
                    new() { time = 30, type = "leave_scene", actorVisualId = "a", locationSlot = "exit" },
                },
            };
        }

        [Test]
        public void SameScenarioAndTime_AlwaysSelectsSameCamera()
        {
            var scenario = MakeScenario();
            var a = ReconstructionCameraController.ShouldUseCloseCamera(scenario, 15f);
            var b = ReconstructionCameraController.ShouldUseCloseCamera(scenario, 15f);
            Assert.AreEqual(a, b);
        }

        [Test]
        public void OverviewCamera_UsedAtEntranceAndExitSlots()
        {
            var scenario = MakeScenario();
            Assert.IsFalse(ReconstructionCameraController.ShouldUseCloseCamera(scenario, 5f));
            Assert.IsFalse(ReconstructionCameraController.ShouldUseCloseCamera(scenario, 35f));
        }

        [Test]
        public void CloseCamera_UsedAtInteractionAndCrimePointSlots()
        {
            var scenario = MakeScenario();
            Assert.IsTrue(ReconstructionCameraController.ShouldUseCloseCamera(scenario, 12f));
            Assert.IsTrue(ReconstructionCameraController.ShouldUseCloseCamera(scenario, 25f));
        }

        [Test]
        public void CutsHappenOnlyAtEventTimestamps_NeverMidSegmentDrift()
        {
            var scenario = MakeScenario();
            // Between t=10 (talk/interaction) and t=20 (attack/crime_point)
            // both slots resolve to the close camera, so no cut should occur
            // anywhere in between — deterministic boundary check.
            for (var t = 10f; t < 20f; t += 1f)
            {
                Assert.IsTrue(ReconstructionCameraController.ShouldUseCloseCamera(scenario, t));
            }
        }
    }
}
