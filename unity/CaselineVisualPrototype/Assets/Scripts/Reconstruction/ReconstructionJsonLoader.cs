using System.Collections.Generic;
using System.Linq;

namespace Caseline.Reconstruction
{
    /// <summary>
    /// Parses and strictly validates a <see cref="ReconstructionScenarioData"/>
    /// from raw JSON text. Never throws — every failure path returns
    /// <c>false</c> plus a human-readable <c>error</c>, matching
    /// <c>CCTVJsonLoader</c>'s own "reject cleanly, never crash" convention
    /// (see that file — this one is deliberately NOT a shared/modified copy
    /// of it, per this phase's "keep CCTV and Reconstruction separate"
    /// instruction).
    ///
    /// Truth-safety / schema-strictness (Phase U5.2 req. 23): this loader
    /// does NOT use <c>UnityEngine.JsonUtility</c> at all, because
    /// <c>JsonUtility.FromJson</c> silently ignores any JSON field it
    /// doesn't recognize — that would make it impossible to actually PROVE
    /// a scenario never smuggled an extra field (a raw <c>culpritId</c>, a
    /// <c>seed</c>, a <c>motive</c>, ...). Instead this loader:
    ///   1. Parses the raw text with <see cref="ReconstructionMiniJson"/>
    ///      into a generic object tree.
    ///   2. Walks that tree and rejects it outright if ANY object anywhere
    ///      (the root, an actor, a waypoint, an event) contains a key
    ///      outside that level's explicit allowlist — an unknown field is
    ///      a hard validation failure, never silently dropped.
    ///   3. Only after every key, value type, and cross-reference has been
    ///      validated does it construct the final
    ///      <see cref="ReconstructionScenarioData"/> POCOs by hand from the
    ///      already-validated tree.
    /// Unity therefore never even transiently holds a value for a field
    /// this schema doesn't define, let alone a CaseTruth-shaped one.
    /// </summary>
    public static class ReconstructionJsonLoader
    {
        private static readonly HashSet<string> RootKeys = new() { "version", "caseId", "environment", "durationSeconds", "actors", "events" };
        private static readonly HashSet<string> ActorKeys = new() { "visualId", "roleForReconstruction", "genericAppearance", "spawnTime", "despawnTime", "waypoints" };
        private static readonly HashSet<string> WaypointKeys = new() { "time", "slot" };
        private static readonly HashSet<string> EventKeys = new() { "time", "type", "actorVisualId", "counterpartyVisualId", "locationSlot", "safeVisualAction" };

        public static bool TryLoad(string json, out ReconstructionScenarioData data, out string error)
        {
            data = null;
            error = null;

            if (string.IsNullOrWhiteSpace(json))
            {
                error = "Reconstruction scenario JSON is empty.";
                return false;
            }

            if (!ReconstructionMiniJson.TryParse(json, out var root, out var parseError))
            {
                error = $"Reconstruction scenario JSON failed to parse: {parseError}";
                return false;
            }

            if (root is not Dictionary<string, object> rootObj)
            {
                error = "Reconstruction scenario JSON root must be an object.";
                return false;
            }

            if (!CheckKeys(rootObj.Keys, RootKeys, "root", out error)) return false;

            if (!TryGetNumber(rootObj, "version", out var versionD, out error)) return false;
            var version = (int)versionD;
            if (version != ReconstructionSchema.SupportedVersion)
            {
                error = $"Unsupported scenario version {version} (expected {ReconstructionSchema.SupportedVersion}).";
                return false;
            }

            if (!TryGetString(rootObj, "caseId", out var caseId, out error)) return false;
            if (string.IsNullOrEmpty(caseId))
            {
                error = "Scenario.caseId must be a non-empty string.";
                return false;
            }

            if (!TryGetString(rootObj, "environment", out var environment, out error)) return false;
            if (!ReconstructionSchema.EnvironmentKinds.Contains(environment))
            {
                error = $"Unknown environment '{environment}'.";
                return false;
            }

            if (!TryGetNumber(rootObj, "durationSeconds", out var durationSeconds, out error)) return false;
            if (durationSeconds < 0)
            {
                error = "Scenario.durationSeconds cannot be negative.";
                return false;
            }

            if (!TryGetArray(rootObj, "actors", out var actorsRaw, out error)) return false;
            if (!TryGetArray(rootObj, "events", out var eventsRaw, out error)) return false;

            var actors = new List<ReconstructionActorData>();
            var seenVisualIds = new HashSet<string>();
            foreach (var rawActor in actorsRaw)
            {
                if (rawActor is not Dictionary<string, object> actorObj)
                {
                    error = "Every entry in Scenario.actors must be an object.";
                    return false;
                }
                if (!CheckKeys(actorObj.Keys, ActorKeys, "actor", out error)) return false;

                if (!TryGetString(actorObj, "visualId", out var visualId, out error)) return false;
                if (string.IsNullOrEmpty(visualId))
                {
                    error = "Every actor requires a non-empty visualId.";
                    return false;
                }
                if (!seenVisualIds.Add(visualId))
                {
                    error = $"Duplicate actor visualId '{visualId}'.";
                    return false;
                }

                if (!TryGetString(actorObj, "roleForReconstruction", out var role, out error)) return false;
                if (!ReconstructionSchema.ActorRoles.Contains(role))
                {
                    error = $"Actor '{visualId}': unknown role '{role}'.";
                    return false;
                }

                if (!TryGetString(actorObj, "genericAppearance", out var appearance, out error)) return false;
                if (string.IsNullOrEmpty(appearance))
                {
                    error = $"Actor '{visualId}': genericAppearance must be a non-empty string.";
                    return false;
                }

                if (!TryGetNumber(actorObj, "spawnTime", out var spawnTime, out error)) return false;
                if (!TryGetNumber(actorObj, "despawnTime", out var despawnTime, out error)) return false;
                if (spawnTime < 0 || despawnTime < 0)
                {
                    error = $"Actor '{visualId}': spawnTime/despawnTime cannot be negative.";
                    return false;
                }
                if (despawnTime < spawnTime)
                {
                    error = $"Actor '{visualId}': despawnTime cannot be before spawnTime.";
                    return false;
                }
                if (spawnTime > durationSeconds || despawnTime > durationSeconds)
                {
                    error = $"Actor '{visualId}': spawnTime/despawnTime cannot exceed durationSeconds.";
                    return false;
                }

                if (!TryGetArray(actorObj, "waypoints", out var waypointsRaw, out error)) return false;
                if (waypointsRaw.Count == 0)
                {
                    error = $"Actor '{visualId}': waypoints must not be empty.";
                    return false;
                }

                var waypoints = new List<ReconstructionWaypointData>();
                foreach (var rawWp in waypointsRaw)
                {
                    if (rawWp is not Dictionary<string, object> wpObj)
                    {
                        error = $"Actor '{visualId}': every waypoint must be an object.";
                        return false;
                    }
                    if (!CheckKeys(wpObj.Keys, WaypointKeys, "waypoint", out error)) return false;
                    if (!TryGetNumber(wpObj, "time", out var wpTime, out error)) return false;
                    if (wpTime < 0 || wpTime > durationSeconds)
                    {
                        error = $"Actor '{visualId}': waypoint time out of range.";
                        return false;
                    }
                    if (!TryGetString(wpObj, "slot", out var wpSlot, out error)) return false;
                    if (!ReconstructionSchema.Slots.Contains(wpSlot))
                    {
                        error = $"Actor '{visualId}': unknown waypoint slot '{wpSlot}'.";
                        return false;
                    }
                    waypoints.Add(new ReconstructionWaypointData { time = (float)wpTime, slot = wpSlot });
                }

                actors.Add(new ReconstructionActorData
                {
                    visualId = visualId,
                    roleForReconstruction = role,
                    genericAppearance = appearance,
                    spawnTime = (float)spawnTime,
                    despawnTime = (float)despawnTime,
                    waypoints = waypoints,
                });
            }

            var events = new List<ReconstructionEventData>();
            foreach (var rawEvent in eventsRaw)
            {
                if (rawEvent is not Dictionary<string, object> eventObj)
                {
                    error = "Every entry in Scenario.events must be an object.";
                    return false;
                }
                if (!CheckKeys(eventObj.Keys, EventKeys, "event", out error)) return false;

                if (!TryGetNumber(eventObj, "time", out var time, out error)) return false;
                if (time < 0 || time > durationSeconds)
                {
                    error = "Event time is out of range [0, durationSeconds].";
                    return false;
                }

                if (!TryGetString(eventObj, "type", out var type, out error)) return false;
                if (!ReconstructionSchema.EventTypes.Contains(type))
                {
                    error = $"Unknown event type '{type}'.";
                    return false;
                }

                if (!TryGetString(eventObj, "actorVisualId", out var actorVisualId, out error)) return false;
                if (!seenVisualIds.Contains(actorVisualId))
                {
                    error = $"Event references unknown actorVisualId '{actorVisualId}'.";
                    return false;
                }

                string counterpartyVisualId = null;
                if (eventObj.ContainsKey("counterpartyVisualId"))
                {
                    if (!TryGetString(eventObj, "counterpartyVisualId", out counterpartyVisualId, out error)) return false;
                    if (!seenVisualIds.Contains(counterpartyVisualId))
                    {
                        error = $"Event references unknown counterpartyVisualId '{counterpartyVisualId}'.";
                        return false;
                    }
                }

                if (!TryGetString(eventObj, "locationSlot", out var locationSlot, out error)) return false;
                if (!ReconstructionSchema.Slots.Contains(locationSlot))
                {
                    error = $"Unknown event locationSlot '{locationSlot}'.";
                    return false;
                }

                string safeVisualAction = null;
                if (eventObj.ContainsKey("safeVisualAction"))
                {
                    if (!TryGetString(eventObj, "safeVisualAction", out safeVisualAction, out error)) return false;
                }

                events.Add(new ReconstructionEventData
                {
                    time = (float)time,
                    type = type,
                    actorVisualId = actorVisualId,
                    counterpartyVisualId = counterpartyVisualId,
                    locationSlot = locationSlot,
                    safeVisualAction = safeVisualAction,
                });
            }

            if (actors.Count == 0)
            {
                error = "Scenario.actors must not be empty.";
                return false;
            }

            data = new ReconstructionScenarioData
            {
                version = version,
                caseId = caseId,
                environment = environment,
                durationSeconds = (float)durationSeconds,
                actors = actors,
                events = events.OrderBy(e => e.time).ToList(),
            };
            return true;
        }

        /// <summary>Rejects a JSON object outright if it contains ANY key
        /// outside `allowed` — the core of this loader's strict
        /// unknown-field rejection (see this file's doc comment).</summary>
        private static bool CheckKeys(IEnumerable<string> actualKeys, HashSet<string> allowed, string levelName, out string error)
        {
            foreach (var key in actualKeys)
            {
                if (!allowed.Contains(key))
                {
                    error = $"Unexpected field '{key}' on a {levelName} object — this is not part of ReconstructionScenario V1.";
                    return false;
                }
            }
            error = null;
            return true;
        }

        private static bool TryGetString(Dictionary<string, object> obj, string key, out string value, out string error)
        {
            value = null;
            if (!obj.TryGetValue(key, out var raw))
            {
                error = $"Missing required field '{key}'.";
                return false;
            }
            if (raw is not string s)
            {
                error = $"Field '{key}' must be a string.";
                return false;
            }
            value = s;
            error = null;
            return true;
        }

        private static bool TryGetNumber(Dictionary<string, object> obj, string key, out double value, out string error)
        {
            value = 0;
            if (!obj.TryGetValue(key, out var raw))
            {
                error = $"Missing required field '{key}'.";
                return false;
            }
            if (raw is not double d)
            {
                error = $"Field '{key}' must be a number.";
                return false;
            }
            value = d;
            error = null;
            return true;
        }

        private static bool TryGetArray(Dictionary<string, object> obj, string key, out List<object> value, out string error)
        {
            value = null;
            if (!obj.TryGetValue(key, out var raw))
            {
                error = $"Missing required field '{key}'.";
                return false;
            }
            if (raw is not List<object> list)
            {
                error = $"Field '{key}' must be an array.";
                return false;
            }
            value = list;
            error = null;
            return true;
        }
    }
}
