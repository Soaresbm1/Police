using System.Collections.Generic;
using UnityEngine;

namespace Caseline.Reconstruction
{
    public struct ReconstructionActorPose
    {
        public bool visible;
        public Vector3 position;
        public Vector3 facing;
        public bool isWalking;
        public string animState;
        public float normalizedTime;
    }

    /// <summary>
    /// Phase U5.2 — pure pose evaluation: `pose = f(actor, events, t)`, with
    /// zero mutable state and zero `deltaTime` accumulation anywhere (req.
    /// 10/22: "position = f(scenario, absolutePlaybackTime)", never
    /// `position += speed * deltaTime`). Calling this twice with the same
    /// `t` always returns byte-identical output; calling it with `t=10`
    /// after `t=40` (scrubbing backward) is exactly as valid as calling it
    /// forward — nothing here remembers the previous call. Mirrors the
    /// split CCTV already uses (`CCTVActorTimeline` / `CCTVActorController`)
    /// without sharing any code with it (Phase U5.2's "keep CCTV and
    /// Reconstruction separate" instruction).
    ///
    /// Section 20's truth boundary in code form: this function may invent
    /// WHERE (zone coordinates, interpolation path) and HOW (walk/idle
    /// blend) an actor moves, but never WHETHER something happened — every
    /// branch below is driven by an actual `ReconstructionEventData` the
    /// projector already decided belonged in the scenario, never a new one
    /// invented here.
    /// </summary>
    public static class ReconstructionActorTimeline
    {
        /// <summary>How long the single semantic "attack" beat is shown,
        /// in seconds — one fixed beat per event, never repeated, never
        /// choreographed into multiple strikes (req. 12).</summary>
        public const float AttackBeatSeconds = 2f;

        /// <summary>How long the victim's stand-to-collapse transition
        /// takes, in seconds, starting immediately after the attack beat
        /// ends — a controlled, deterministic fall, not a ragdoll.</summary>
        public const float CollapseTransitionSeconds = 1.5f;

        /// <summary>How long the staging beat is shown — one generic manipulation gesture, never a
        /// reconstruction of what was actually moved (U5.4 §18).</summary>
        public const float StageBeatSeconds = 2f;

        /// <summary>
        /// Longest a leg between two slots is walked for. The walk sits at the END of the leg's truth interval,
        /// arriving exactly at the recorded waypoint time, and the actor waits at the previous slot until then.
        /// Truth records where someone was at each anchored event, never that they crossed the scene at a crawl:
        /// interpolating a ten-minute interval as one continuous walk was a presentation artefact (U5.4 §2).
        /// Mirrors MAX_WALK_SECONDS in reconstruction-presentation.ts.
        /// </summary>
        public const float MaxWalkSeconds = 8f;

        private const float WalkCycleHz = 1.2f;

        public static ReconstructionActorPose Evaluate(ReconstructionActorData actor, IReadOnlyList<ReconstructionEventData> allEvents, string environment, float t)
        {
            if (t < actor.spawnTime || t > actor.despawnTime)
            {
                return new ReconstructionActorPose { visible = false };
            }

            ReconstructionEventData attackEvent = null;
            for (var i = 0; i < allEvents.Count; i++)
            {
                if (allEvents[i].type == "attack")
                {
                    attackEvent = allEvents[i];
                    break;
                }
            }

            if (attackEvent != null)
            {
                var isAttacker = attackEvent.actorVisualId == actor.visualId;
                var isTarget = attackEvent.counterpartyVisualId == actor.visualId;
                if (isAttacker || isTarget)
                {
                    var attackStart = attackEvent.time;
                    var attackEnd = attackStart + AttackBeatSeconds;
                    var scenePos = ReconstructionZoneLayout.GetActorZonePosition(environment, attackEvent.locationSlot, actor.roleForReconstruction);

                    if (t >= attackStart && t < attackEnd)
                    {
                        var normalized = Mathf.Clamp01((t - attackStart) / AttackBeatSeconds);
                        // The target is shown holding a passive, non-reactive
                        // pose during the beat — no invented struggle, no
                        // extra attack cycles (req. 12).
                        var animState = isAttacker ? AnimStateForSafeVisualAction(attackEvent.safeVisualAction) : "Idle";
                        return new ReconstructionActorPose
                        {
                            visible = true,
                            position = scenePos,
                            facing = Vector3.forward,
                            isWalking = false,
                            animState = animState,
                            normalizedTime = animState == "Idle" ? 0f : normalized,
                        };
                    }

                    if (isTarget && t >= attackEnd)
                    {
                        var collapseElapsed = t - attackEnd;
                        var normalized = Mathf.Clamp01(collapseElapsed / CollapseTransitionSeconds);
                        return new ReconstructionActorPose
                        {
                            visible = true,
                            position = scenePos,
                            facing = Vector3.forward,
                            isWalking = false,
                            animState = "Collapse",
                            normalizedTime = normalized,
                        };
                    }
                    // Attacker after the beat falls through to ordinary
                    // waypoint interpolation below (e.g. walking to "exit").
                }
            }

            // A staging beat, only ever for the actor the projector anchored it to (U5.4 §18): one generic
            // manipulation gesture at the recorded slot, never a reenactment of what was moved or staged.
            for (var i = 0; i < allEvents.Count; i++)
            {
                var staging = allEvents[i];
                if (staging.type != "stage_scene" || staging.actorVisualId != actor.visualId) continue;
                if (t < staging.time || t >= staging.time + StageBeatSeconds) continue;
                return new ReconstructionActorPose
                {
                    visible = true,
                    position = ReconstructionZoneLayout.GetActorZonePosition(environment, staging.locationSlot, actor.roleForReconstruction),
                    facing = Vector3.forward,
                    isWalking = false,
                    animState = "ManipulateScene",
                    normalizedTime = Mathf.Clamp01((t - staging.time) / StageBeatSeconds),
                };
            }

            return EvaluateWaypoints(actor, environment, t);
        }

        private static ReconstructionActorPose EvaluateWaypoints(ReconstructionActorData actor, string environment, float t)
        {
            var waypoints = actor.waypoints;
            var walkPhase = Mathf.Repeat(t * WalkCycleHz, 1f);

            if (t <= waypoints[0].time)
            {
                var pos = ReconstructionZoneLayout.GetActorZonePosition(environment, waypoints[0].slot, actor.roleForReconstruction);
                return new ReconstructionActorPose { visible = true, position = pos, facing = Vector3.forward, isWalking = false, animState = "Idle", normalizedTime = 0f };
            }

            for (var i = 0; i < waypoints.Count - 1; i++)
            {
                var a = waypoints[i];
                var b = waypoints[i + 1];
                if (t < a.time || t > b.time) continue;

                var posA = ReconstructionZoneLayout.GetActorZonePosition(environment, a.slot, actor.roleForReconstruction);
                var posB = ReconstructionZoneLayout.GetActorZonePosition(environment, b.slot, actor.roleForReconstruction);
                if (Mathf.Approximately(a.time, b.time) || posA == posB)
                {
                    return new ReconstructionActorPose { visible = true, position = posA, facing = Vector3.forward, isWalking = false, animState = "Idle", normalizedTime = 0f };
                }

                // Wait at the previous slot, then walk the last MaxWalkSeconds of the leg, arriving exactly on time.
                var walkStart = b.time - Mathf.Min(b.time - a.time, MaxWalkSeconds);
                if (t <= walkStart)
                {
                    return new ReconstructionActorPose { visible = true, position = posA, facing = Vector3.forward, isWalking = false, animState = "Idle", normalizedTime = 0f };
                }

                var segT = Mathf.Clamp01((t - walkStart) / (b.time - walkStart));
                var pos = Vector3.Lerp(posA, posB, segT);
                var dir = (posB - posA).normalized;
                return new ReconstructionActorPose { visible = true, position = pos, facing = dir, isWalking = true, animState = "Walk", normalizedTime = walkPhase };
            }

            var last = waypoints[waypoints.Count - 1];
            var lastPos = ReconstructionZoneLayout.GetActorZonePosition(environment, last.slot, actor.roleForReconstruction);
            return new ReconstructionActorPose { visible = true, position = lastPos, facing = Vector3.forward, isWalking = false, animState = "Idle", normalizedTime = 0f };
        }

        /// <summary>
        /// One pose per safe visual action the projector can emit (U5.4 §9–§17). Each is a single deterministic
        /// beat that shows the KIND of action CaseTruth records and nothing more: no weapon model, no wound, no
        /// repeat, no projectile. `attack_administer_substance` (poisoning and staged overdose alike) maps to a
        /// deliberately neutral interaction, because CaseTruth has no structured field for how a substance was
        /// given — a drink, food or syringe would all be invented. An unknown action falls back to that same
        /// neutral beat rather than to a blow, so a future action can never be mistaken for a physical attack.
        /// </summary>
        public static string AnimStateForSafeVisualAction(string safeVisualAction)
        {
            switch (safeVisualAction)
            {
                case "attack_strike": return "AttackStrike";
                case "attack_strangle": return "AttackStrangle";
                case "attack_stab": return "AttackStab";
                case "attack_firearm": return "AttackFirearm";
                case "attack_push": return "AttackPush";
                default: return "NeutralInteraction";
            }
        }
    }
}
