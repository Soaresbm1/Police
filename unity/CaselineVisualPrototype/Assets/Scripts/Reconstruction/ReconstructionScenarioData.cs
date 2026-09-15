using System.Collections.Generic;

namespace Caseline.Reconstruction
{
    /// <summary>
    /// Phase U5.2 — plain data model mirroring the TypeScript
    /// `ReconstructionScenario` V1 schema (see
    /// `lib/game-engine/reconstruction/reconstruction-types.ts`) EXACTLY.
    /// Deliberately NOT `[Serializable]`/`UnityEngine.JsonUtility`-bound:
    /// these classes are only ever constructed by
    /// <see cref="ReconstructionJsonLoader"/> AFTER its own strict,
    /// hand-rolled validation pass — see that file's doc comment for why
    /// `JsonUtility.FromJson` alone (which silently ignores unknown JSON
    /// fields) is not an acceptable truth-safety boundary here.
    ///
    /// Truth-safety note: there is no field anywhere in this file for a
    /// CaseTruth-shaped concept — no seed, no PersonId, no motive, no
    /// relationship, no evidence, no hidden role. This is intentional and
    /// exhaustive: Unity's reconstruction subsystem knows nothing beyond
    /// what a ReconstructionScenario JSON explicitly contains.
    /// </summary>
    public sealed class ReconstructionWaypointData
    {
        public float time;
        public string slot;
    }

    public sealed class ReconstructionActorData
    {
        public string visualId;
        public string roleForReconstruction;
        public string genericAppearance;
        public float spawnTime;
        public float despawnTime;
        public List<ReconstructionWaypointData> waypoints = new();
    }

    public sealed class ReconstructionEventData
    {
        public float time;
        public string type;
        public string actorVisualId;

        /// <summary>Null when the source JSON omitted this optional field —
        /// never an empty string standing in for "absent".</summary>
        public string counterpartyVisualId;

        public string locationSlot;

        /// <summary>Null when the source JSON omitted this optional field.</summary>
        public string safeVisualAction;
    }

    public sealed class ReconstructionScenarioData
    {
        public int version;
        public string caseId;
        public string environment;
        public float durationSeconds;
        public List<ReconstructionActorData> actors = new();
        public List<ReconstructionEventData> events = new();
    }

    /// <summary>Closed vocabularies the loader validates every relevant
    /// string field against — kept in one place so the TypeScript and C#
    /// sides can be diffed by eye against `reconstruction-types.ts`.</summary>
    public static class ReconstructionSchema
    {
        public const int SupportedVersion = 1;

        public static readonly HashSet<string> EnvironmentKinds = new() { "corridor", "parking", "shop", "street", "generic" };

        public static readonly HashSet<string> ActorRoles = new() { "victim", "culprit", "accomplice", "unnamed" };

        public static readonly HashSet<string> EventTypes = new()
        {
            "meet", "talk", "attack", "phone_use", "leave_scene", "use_object", "discover", "stage_scene",
        };

        public static readonly HashSet<string> Slots = new() { "entrance", "interaction", "crime_point", "interior_center", "exit" };
    }
}
