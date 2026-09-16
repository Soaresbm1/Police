using System.Collections.Generic;
using UnityEngine;

namespace Caseline.Reconstruction
{
    /// <summary>
    /// Phase U5.5 — picks the reconstruction's shot as a pure function of the scenario and a time. The only inputs
    /// are presentation data every viewer already sees: the environment kind, each event's type, safe visual action,
    /// semantic slot and timestamp, and — for a departure — when the departing figure starts to walk. No identity,
    /// role, motive, evidence or randomness is read, and nothing here is written back into the scenario.
    ///
    /// Cut rule. Each event owns the shot from its shot start until the next event's shot starts, so a cut only
    /// ever happens at a semantic boundary:
    ///   - talk, discover (and any other event): the shot starts exactly at the event's timestamp;
    ///   - attack, stage_scene: <see cref="ActionLeadSeconds"/> early, so the framing is established before the
    ///     beat's first frame instead of cutting on it;
    ///   - leave_scene: when the departing figure's walk to the exit begins, so the overview shows the whole
    ///     departure instead of the action shot watching someone walk out of it (or into its lens).
    /// A shot never starts before the previous event's own visual beat has finished (an attack's beat and the
    /// collapse, a staging gesture), nor after its own event's timestamp. The lead moves the camera only: event
    /// times, actor poses and the presentation timeline are untouched.
    /// </summary>
    public static class ReconstructionCameraDirector
    {
        public const float ActionLeadSeconds = 1f;

        private static readonly HashSet<string> PhysicalAttackActions = new()
        {
            "attack_strike", "attack_stab", "attack_strangle", "attack_firearm", "attack_push",
        };

        /// <summary>The shot an event asks for. A substance, or any attack action this build does not know, gets the
        /// neutral interaction framing — the same fallback the actor animation uses — never attack framing.</summary>
        public static ReconstructionCameraMode ModeForEvent(ReconstructionEventData e)
        {
            switch (e.type)
            {
                case "talk":
                case "meet":
                case "stage_scene":
                    return ReconstructionCameraMode.Interaction;
                case "attack":
                    return e.safeVisualAction != null && PhysicalAttackActions.Contains(e.safeVisualAction)
                        ? ReconstructionCameraMode.PhysicalAttack
                        : ReconstructionCameraMode.Interaction;
                case "discover":
                    return ReconstructionCameraMode.Discovery;
                default:
                    return ReconstructionCameraMode.Overview;
            }
        }

        /// <summary>How long an event's own visual beat keeps playing after its timestamp.</summary>
        public static float BeatSeconds(ReconstructionEventData e) => e.type switch
        {
            "attack" => ReconstructionActorTimeline.AttackBeatSeconds + ReconstructionActorTimeline.CollapseTransitionSeconds,
            "stage_scene" => ReconstructionActorTimeline.StageBeatSeconds,
            _ => 0f,
        };

        /// <summary>When event `index`'s shot begins. Events are in timestamp order, and so are these starts.</summary>
        public static float ShotStartTime(ReconstructionScenarioData scenario, int index)
        {
            var e = scenario.events[index];
            var start = e.type switch
            {
                "attack" or "stage_scene" => e.time - ActionLeadSeconds,
                "leave_scene" => DepartureWalkStart(scenario, e),
                _ => e.time,
            };
            if (index == 0) return start;
            var previous = scenario.events[index - 1];
            return Mathf.Min(e.time, Mathf.Max(start, previous.time + BeatSeconds(previous)));
        }

        private static float DepartureWalkStart(ReconstructionScenarioData scenario, ReconstructionEventData e)
        {
            foreach (var actor in scenario.actors)
            {
                if (actor.visualId == e.actorVisualId) return ReconstructionActorTimeline.WalkStartTime(actor, scenario.environment, e.time);
            }
            return e.time;
        }

        /// <summary>The event whose shot is on screen at `time`, or null before the first one begins.</summary>
        public static ReconstructionEventData ShotEvent(ReconstructionScenarioData scenario, float time)
        {
            ReconstructionEventData current = null;
            for (var i = 0; i < scenario.events.Count; i++)
            {
                if (ShotStartTime(scenario, i) > time) break;
                current = scenario.events[i];
            }
            return current;
        }

        public static ReconstructionCameraShot SelectShot(ReconstructionScenarioData scenario, float time)
        {
            var e = ShotEvent(scenario, time);
            if (e == null) return ReconstructionCameraPresets.Overview();
            return ReconstructionCameraPresets.Shot(scenario.environment, ModeForEvent(e), e.locationSlot);
        }

        /// <summary>Every cut of a scenario resolved once, in order, so playback only has to find where `time` falls.
        /// Always equivalent to <see cref="SelectShot"/>.</summary>
        public sealed class ShotPlan
        {
            private readonly float[] starts;
            private readonly ReconstructionCameraShot[] shots;

            public ShotPlan(ReconstructionScenarioData scenario)
            {
                Scenario = scenario;
                starts = new float[scenario.events.Count];
                shots = new ReconstructionCameraShot[scenario.events.Count];
                for (var i = 0; i < scenario.events.Count; i++)
                {
                    var e = scenario.events[i];
                    starts[i] = ShotStartTime(scenario, i);
                    shots[i] = ReconstructionCameraPresets.Shot(scenario.environment, ModeForEvent(e), e.locationSlot);
                }
            }

            public ReconstructionScenarioData Scenario { get; }

            public ReconstructionCameraShot ShotAt(float time)
            {
                var shot = ReconstructionCameraPresets.Overview();
                for (var i = 0; i < starts.Length && starts[i] <= time; i++) shot = shots[i];
                return shot;
            }
        }
    }
}
