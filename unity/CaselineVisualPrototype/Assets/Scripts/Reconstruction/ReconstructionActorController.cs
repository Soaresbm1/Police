using System.Collections.Generic;
using UnityEngine;

namespace Caseline.Reconstruction
{
    /// <summary>
    /// Applies one actor's <see cref="ReconstructionActorTimeline"/> pose to
    /// a real Transform/Animator each time the playback clock changes.
    /// Deterministic by construction: every pose comes from
    /// `ReconstructionActorTimeline.Evaluate(actor, events, environment,
    /// time)`, a pure function, and the Animator's own internal clock is
    /// frozen (`animator.speed = 0f`) with every state entered via an
    /// explicit `normalizedTime` — the same technique
    /// `CCTVActorController.Apply` already uses (not shared code; the same
    /// pattern independently applied here, see that file).
    /// </summary>
    public class ReconstructionActorController : MonoBehaviour
    {
        [SerializeField] private Animator animator;

        private static readonly int IdleState = Animator.StringToHash("Idle");
        private static readonly int WalkState = Animator.StringToHash("Walk");
        private static readonly int AttackStrikeState = Animator.StringToHash("AttackStrike");
        private static readonly int AttackStrangleState = Animator.StringToHash("AttackStrangle");
        private static readonly int CollapseState = Animator.StringToHash("Collapse");

        public ReconstructionActorData Data { get; private set; }
        public List<ReconstructionEventData> Events { get; private set; }
        public string Environment { get; private set; }

        public void Configure(ReconstructionActorData data, List<ReconstructionEventData> events, string environment)
        {
            Data = data;
            Events = events;
            Environment = environment;
            ApplyGenericAppearance(data.genericAppearance);
        }

        /// <summary>Subtle clothing-tone tint only (req. 8/13) — driven
        /// exclusively by `genericAppearance`, never by
        /// `roleForReconstruction`. There is no branch anywhere on "is this
        /// the culprit" that changes color/material — role only ever
        /// reaches a text label (see `ReconstructionOverlay`), never a
        /// visual cue, so nothing here could read as guilt-coded styling.</summary>
        private void ApplyGenericAppearance(string genericAppearance)
        {
            var tint = ReconstructionAppearanceUtil.ToneTint(genericAppearance);
            foreach (var renderer in GetComponentsInChildren<Renderer>())
            {
                renderer.material.color = tint;
            }
        }

        public void SetAnimator(Animator animatorComponent)
        {
            animator = animatorComponent;
        }

        /// <summary>Re-derives this actor's full visual state from an
        /// absolute scenario time — safe to call repeatedly with the same
        /// `time`, or with an earlier `time` than a previous call
        /// (scrubbing backward), since nothing here reads its own previous
        /// output (req. 10/22).</summary>
        public void Apply(float time)
        {
            if (Data == null) return;

            var pose = ReconstructionActorTimeline.Evaluate(Data, Events, Environment, time);
            gameObject.SetActive(pose.visible);
            if (!pose.visible) return;

            transform.position = pose.position;
            if (pose.facing.sqrMagnitude > 0.0001f)
            {
                transform.rotation = Quaternion.LookRotation(pose.facing, Vector3.up);
            }

            if (animator == null) return;

            var stateHash = pose.animState switch
            {
                "Walk" => WalkState,
                "AttackStrike" => AttackStrikeState,
                "AttackStrangle" => AttackStrangleState,
                "Collapse" => CollapseState,
                _ => IdleState,
            };
            animator.Play(stateHash, 0, pose.normalizedTime);
            // Freeze the Animator's own internal clock, same as CCTVActorController
            // — every pose comes from the explicit normalizedTime passed to
            // Play() above, never from Update()-driven playback, so
            // re-applying the same `time` always reproduces the exact same
            // pose regardless of playback speed or seek direction.
            animator.speed = 0f;
        }
    }
}
