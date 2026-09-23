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

        /// <summary>Presentation-only staging distance, in metres: how close two actors' resolved positions must
        /// be to count as "sharing a slot" for facing purposes. Comfortably above the largest fixed lateral
        /// gap two co-staged actors can have (culprit/victim: 1.1m total; accomplice/unnamed: 2.7m total — see
        /// `ReconstructionZoneLayout.LateralOffsetByRole`) and comfortably below the shortest distance between two
        /// different slots in any environment (corridor's closest pair, "interaction" to "crime_point", is 3m).</summary>
        private const float ColocationFacingDistance = 3.5f;

        /// <summary>U5.6 iteration 1 — presentation-only fix for actors reading as "side-by-side staged figures"
        /// rather than naturally interacting people: every idle/interaction/staging pose previously used a fixed
        /// `Vector3.forward`, regardless of whether another actor was staged right next to them (found true for
        /// EVERY non-walking state — talk, meet, discover, attack, stage_scene — by numeric audit of this file
        /// before this change). `allActors` is optional and defaults to null so every pre-existing call site
        /// (including every test in `ReconstructionActorTimelineTests`) keeps its exact prior
        /// `facing = Vector3.forward` behavior unchanged unless it opts in. When provided,
        /// `ReconstructionActorController` passes the full spawned roster so an idling actor can face whichever
        /// OTHER actor is currently resolved to the same staged slot — never a claim about which way anyone
        /// actually faced, exactly like the position table itself.</summary>
        public static ReconstructionActorPose Evaluate(
            ReconstructionActorData actor,
            IReadOnlyList<ReconstructionEventData> allEvents,
            string environment,
            float t,
            IReadOnlyList<ReconstructionActorData> allActors = null)
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
                            facing = FacingTowardColocatedActor(actor, scenePos, allActors, allEvents, environment, t),
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
                var stagePos = ReconstructionZoneLayout.GetActorZonePosition(environment, staging.locationSlot, actor.roleForReconstruction);
                return new ReconstructionActorPose
                {
                    visible = true,
                    position = stagePos,
                    facing = FacingTowardColocatedActor(actor, stagePos, allActors, allEvents, environment, t),
                    isWalking = false,
                    animState = "ManipulateScene",
                    normalizedTime = Mathf.Clamp01((t - staging.time) / StageBeatSeconds),
                };
            }

            return EvaluateWaypoints(actor, allEvents, environment, t, allActors);
        }

        private static ReconstructionActorPose EvaluateWaypoints(
            ReconstructionActorData actor,
            IReadOnlyList<ReconstructionEventData> allEvents,
            string environment,
            float t,
            IReadOnlyList<ReconstructionActorData> allActors)
        {
            var waypoints = actor.waypoints;
            var walkPhase = Mathf.Repeat(t * WalkCycleHz, 1f);

            if (t <= waypoints[0].time)
            {
                var pos = ReconstructionZoneLayout.GetActorZonePosition(environment, waypoints[0].slot, actor.roleForReconstruction);
                return new ReconstructionActorPose { visible = true, position = pos, facing = FacingTowardColocatedActor(actor, pos, allActors, allEvents, environment, t), isWalking = false, animState = "Idle", normalizedTime = 0f };
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
                    return new ReconstructionActorPose { visible = true, position = posA, facing = FacingTowardColocatedActor(actor, posA, allActors, allEvents, environment, t), isWalking = false, animState = "Idle", normalizedTime = 0f };
                }

                // Wait at the previous slot, then walk the last MaxWalkSeconds of the leg, arriving exactly on time.
                var walkStart = LegWalkStart(a, b);
                if (t <= walkStart)
                {
                    return new ReconstructionActorPose { visible = true, position = posA, facing = FacingTowardColocatedActor(actor, posA, allActors, allEvents, environment, t), isWalking = false, animState = "Idle", normalizedTime = 0f };
                }

                var segT = Mathf.Clamp01((t - walkStart) / (b.time - walkStart));
                var pos = Vector3.Lerp(posA, posB, segT);
                var dir = (posB - posA).normalized;
                return new ReconstructionActorPose { visible = true, position = pos, facing = dir, isWalking = true, animState = "Walk", normalizedTime = walkPhase };
            }

            var last = waypoints[waypoints.Count - 1];
            var lastPos = ReconstructionZoneLayout.GetActorZonePosition(environment, last.slot, actor.roleForReconstruction);
            return new ReconstructionActorPose { visible = true, position = lastPos, facing = FacingTowardColocatedActor(actor, lastPos, allActors, allEvents, environment, t), isWalking = false, animState = "Idle", normalizedTime = 0f };
        }

        /// <summary>Presentation-only: if another actor currently resolves to a position within
        /// <see cref="ColocationFacingDistance"/> of `myPosition` (i.e. staged at the same slot right now), face
        /// toward the nearest one instead of the fixed default `Vector3.forward`. Recurses into
        /// <see cref="Evaluate"/> for each other actor's position with `allActors` omitted, which guarantees this
        /// can never recurse a second level (that nested call's own facing computation is skipped entirely, since
        /// its `allActors` is null) — no infinite mutual recursion between two colocated actors evaluating each
        /// other. `allActors` is null on every pre-existing call site, so this returns `Vector3.forward` exactly as
        /// before unless a caller opts in.</summary>
        private static Vector3 FacingTowardColocatedActor(
            ReconstructionActorData actor,
            Vector3 myPosition,
            IReadOnlyList<ReconstructionActorData> allActors,
            IReadOnlyList<ReconstructionEventData> allEvents,
            string environment,
            float t)
        {
            if (allActors == null) return Vector3.forward;

            Vector3? closestPosition = null;
            var closestDistance = float.MaxValue;
            foreach (var other in allActors)
            {
                if (other == null || other.visualId == actor.visualId) continue;
                var otherPose = Evaluate(other, allEvents, environment, t); // allActors omitted: no further recursion
                if (!otherPose.visible) continue;
                var distance = Vector3.Distance(myPosition, otherPose.position);
                if (distance < ColocationFacingDistance && distance < closestDistance)
                {
                    closestDistance = distance;
                    closestPosition = otherPose.position;
                }
            }

            if (!closestPosition.HasValue) return Vector3.forward;
            var direction = closestPosition.Value - myPosition;
            direction.y = 0f;
            return direction.sqrMagnitude > 0.0001f ? direction.normalized : Vector3.forward;
        }

        private static float LegWalkStart(ReconstructionWaypointData a, ReconstructionWaypointData b) => b.time - Mathf.Min(b.time - a.time, MaxWalkSeconds);

        /// <summary>When the walk that brings `actor` to its waypoint at `arrivalTime` begins, by the same rule pose
        /// evaluation applies; `arrivalTime` itself when no walk leads there (a first waypoint, a leg that stays on
        /// one spot, or no waypoint at that time).</summary>
        public static float WalkStartTime(ReconstructionActorData actor, string environment, float arrivalTime)
        {
            var waypoints = actor.waypoints;
            for (var i = 1; i < waypoints.Count; i++)
            {
                var a = waypoints[i - 1];
                var b = waypoints[i];
                if (b.time != arrivalTime) continue;
                var posA = ReconstructionZoneLayout.GetActorZonePosition(environment, a.slot, actor.roleForReconstruction);
                var posB = ReconstructionZoneLayout.GetActorZonePosition(environment, b.slot, actor.roleForReconstruction);
                return Mathf.Approximately(a.time, b.time) || posA == posB ? arrivalTime : LegWalkStart(a, b);
            }
            return arrivalTime;
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
