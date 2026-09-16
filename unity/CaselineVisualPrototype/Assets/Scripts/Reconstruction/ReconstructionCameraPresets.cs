using System.Collections.Generic;
using UnityEngine;

namespace Caseline.Reconstruction
{
    /// <summary>The reconstruction's fixed shots. Presentation only — never part of ReconstructionScenario.</summary>
    public enum ReconstructionCameraMode
    {
        /// <summary>The wide establishing shot: departures, anything not framed more closely.</summary>
        Overview,

        /// <summary>A conversation, a neutral interaction (poisoning, staged overdose) or a staging gesture.</summary>
        Interaction,

        /// <summary>A strike, thrust, strangulation, aimed shot or shove, with attacker and victim both in frame.</summary>
        PhysicalAttack,

        /// <summary>The body and the person who discovers it, with enough of the scene around them to read as later.</summary>
        Discovery,
    }

    /// <summary>One fully resolved camera placement. Equal inputs produce bit-identical shots.</summary>
    public readonly struct ReconstructionCameraShot : System.IEquatable<ReconstructionCameraShot>
    {
        public readonly ReconstructionCameraMode Mode;
        public readonly Vector3 Position;
        public readonly Quaternion Rotation;
        public readonly float FieldOfView;

        public ReconstructionCameraShot(ReconstructionCameraMode mode, Vector3 position, Quaternion rotation, float fieldOfView)
        {
            Mode = mode;
            Position = position;
            Rotation = rotation;
            FieldOfView = fieldOfView;
        }

        public bool Equals(ReconstructionCameraShot other) =>
            Mode == other.Mode && Position == other.Position && Rotation == other.Rotation && FieldOfView == other.FieldOfView;

        public override bool Equals(object obj) => obj is ReconstructionCameraShot other && Equals(other);

        public override int GetHashCode() => System.HashCode.Combine(Mode, Position, Rotation, FieldOfView);
    }

    /// <summary>
    /// Phase U5.5 — every reconstruction camera number in one table. The overview is one world-space shot shared
    /// by all environments (unchanged since U5.2). Every other mode is a fixed framing — distance, yaw, pitch, field
    /// of view — aimed at the event's semantic slot in that environment, so the same environment, mode and slot always
    /// give the same transform. An environment may override a mode's framing; nothing else may.
    ///
    /// Camera framing uses presentation-space actor positions and does not assert factual crime-scene coordinates.
    /// The aim point is the slot's staging coordinate from ReconstructionZoneLayout, which is also the midpoint of
    /// the two people a two-person event stages there (their fixed lateral offsets are symmetric); like that table,
    /// it is a readability choice, never a claim about where anyone actually stood.
    /// </summary>
    public static class ReconstructionCameraPresets
    {
        public static readonly Vector3 OverviewPosition = new(0f, 6.75f, -9.78f);
        public static readonly Vector3 OverviewDirection = new Vector3(0f, -0.7f, 1f).normalized;
        public const float OverviewFieldOfView = 55f;

        public readonly struct Framing
        {
            /// <summary>Metres from the aim point back to the camera, along the view direction.</summary>
            public readonly float Distance;

            /// <summary>Horizontal angle from the environment's +z axis. The actors face +z and stand side by side
            /// along x, so a modest yaw looks across a forward beat instead of down its length, without stacking the
            /// two people behind each other. Negative: the camera stands on the +x side, where the scene's directional
            /// light falls. From there the actors show their lit side against the lit walls, and a forward beat
            /// reaches across the screen toward the other person. The U5.4 camera stood on the unlit side, where
            /// dark figures sat against the unlit east wall and every beat pointed away from its counterpart.</summary>
            public readonly float YawDegrees;

            /// <summary>Downward tilt.</summary>
            public readonly float PitchDegrees;

            public readonly float FieldOfView;

            /// <summary>Height of the aim point above the slot's floor position.</summary>
            public readonly float AimHeight;

            public Framing(float distance, float yawDegrees, float pitchDegrees, float fieldOfView, float aimHeight)
            {
                Distance = distance;
                YawDegrees = yawDegrees;
                PitchDegrees = pitchDegrees;
                FieldOfView = fieldOfView;
                AimHeight = aimHeight;
            }
        }

        private static readonly Dictionary<ReconstructionCameraMode, Framing> DefaultFraming = new()
        {
            [ReconstructionCameraMode.Interaction] = new Framing(distance: 7.4f, yawDegrees: -30f, pitchDegrees: 14f, fieldOfView: 45f, aimHeight: 0.9f),
            [ReconstructionCameraMode.PhysicalAttack] = new Framing(distance: 6.6f, yawDegrees: -36f, pitchDegrees: 12f, fieldOfView: 45f, aimHeight: 0.9f),
            [ReconstructionCameraMode.Discovery] = new Framing(distance: 7.6f, yawDegrees: -30f, pitchDegrees: 16f, fieldOfView: 45f, aimHeight: 0.6f),
        };

        private static readonly Dictionary<(string environment, ReconstructionCameraMode mode), Framing> EnvironmentFraming = new();

        public static Framing FramingFor(string environment, ReconstructionCameraMode mode)
        {
            if (mode == ReconstructionCameraMode.Overview) throw new System.ArgumentException("the overview is a fixed world-space shot, not a slot framing", nameof(mode));
            return EnvironmentFraming.TryGetValue((environment, mode), out var framing) ? framing : DefaultFraming[mode];
        }

        public static ReconstructionCameraShot Overview() =>
            new(ReconstructionCameraMode.Overview, OverviewPosition, Quaternion.LookRotation(OverviewDirection, Vector3.up), OverviewFieldOfView);

        public static ReconstructionCameraShot Shot(string environment, ReconstructionCameraMode mode, string slot)
        {
            if (mode == ReconstructionCameraMode.Overview) return Overview();
            var framing = FramingFor(environment, mode);
            var aim = ReconstructionZoneLayout.GetZonePosition(environment, slot) + Vector3.up * framing.AimHeight;
            var rotation = Quaternion.Euler(framing.PitchDegrees, framing.YawDegrees, 0f);
            var position = aim - rotation * Vector3.forward * framing.Distance;
            return new ReconstructionCameraShot(mode, position, rotation, framing.FieldOfView);
        }
    }
}
