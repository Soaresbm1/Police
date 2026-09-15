using NUnit.Framework;
using UnityEditor;
using UnityEditor.Animations;

namespace Caseline.Reconstruction.Tests
{
    /// <summary>
    /// U5.2.1 regression guard. The built controller previously shipped with
    /// every state's motion null, because the clips were only ever created in
    /// memory and never saved as assets — so the player animated nothing and
    /// neither the attack beat nor the victim's collapse ever rendered. The
    /// pose-selection tests all passed throughout, because they assert which
    /// state the timeline picks, not that the state can actually play.
    /// </summary>
    public class ReconstructionAnimatorAssetTests
    {
        private const string ControllerPath = "Assets/Animations/Reconstruction/Reconstruction_Actor.controller";

        private static readonly string[] ExpectedStates = { "Idle", "Walk", "AttackStrike", "AttackStrangle", "Collapse" };

        [Test]
        public void EveryAnimatorState_HasA_PersistedMotion()
        {
            var controller = AssetDatabase.LoadAssetAtPath<AnimatorController>(ControllerPath);
            Assert.IsNotNull(controller, $"missing animator controller at {ControllerPath} — run Tools/CASELINE/Build Reconstruction Prototype Scene");

            var states = controller.layers[0].stateMachine.states;
            Assert.AreEqual(ExpectedStates.Length, states.Length);

            foreach (var expected in ExpectedStates)
            {
                var match = System.Array.Find(states, s => s.state.name == expected);
                Assert.IsNotNull(match.state, $"animator has no '{expected}' state");
                Assert.IsNotNull(match.state.motion, $"'{expected}' state has no motion — the clip was never saved as an asset, so the player would render nothing for it");
                Assert.IsTrue(AssetDatabase.Contains(match.state.motion), $"'{expected}' motion is not a persisted asset and will be lost outside the building Editor session");
            }
        }
    }
}
