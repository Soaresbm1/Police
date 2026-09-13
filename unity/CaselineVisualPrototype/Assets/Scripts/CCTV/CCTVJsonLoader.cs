using UnityEngine;

namespace Caseline.CCTV
{
    /// <summary>
    /// Parses and validates a <see cref="CCTVScenarioData"/> from raw JSON
    /// text. Never throws on malformed input — every failure path returns
    /// <c>false</c> plus a human-readable <paramref name="error"/> string,
    /// per the brief's "log a clear error, do not crash" requirement.
    ///
    /// Truth-safe design (Phase U1, req. 15): this parser — and the schema
    /// it parses — only ever needs to express "an actor is visible between
    /// two times, moving from point A to point B, at some walk speed,
    /// identified or not". There is deliberately no field anywhere for a
    /// culprit id, motive, evidence relevance, hidden role, secret
    /// CaseTruth, witness truthfulness, or scoring data — if a future
    /// CASELINE integration ever needs to feed this loader real data, the
    /// safe projection already used by the Next.js CCTV renderer
    /// (`CCTVSequenceDescriptor`) maps onto this schema almost directly.
    /// </summary>
    public static class CCTVJsonLoader
    {
        public static bool TryLoad(string json, out CCTVScenarioData data, out string error)
        {
            data = null;
            error = null;

            if (string.IsNullOrWhiteSpace(json))
            {
                error = "CCTV scenario JSON is empty.";
                return false;
            }

            CCTVScenarioData parsed;
            try
            {
                parsed = JsonUtility.FromJson<CCTVScenarioData>(json);
            }
            catch (System.Exception e)
            {
                error = $"CCTV scenario JSON failed to parse: {e.Message}";
                return false;
            }

            var validationError = Validate(parsed);
            if (validationError != null)
            {
                error = validationError;
                return false;
            }

            data = parsed;
            return true;
        }

        /// <summary>Pure validation — no I/O, safe to unit test directly.
        /// Returns null when the scenario is well-formed enough to
        /// render, otherwise a short human-readable reason.</summary>
        public static string Validate(CCTVScenarioData data)
        {
            if (data == null) return "Scenario is null.";
            if (data.camera == null) return "Scenario.camera is required.";
            if (!IsVec3(data.camera.position)) return "Scenario.camera.position must have exactly 3 components.";
            if (!IsVec3(data.camera.rotation)) return "Scenario.camera.rotation must have exactly 3 components.";
            if (data.durationSeconds <= 0f) return "Scenario.durationSeconds must be greater than 0.";
            if (data.actors == null) return "Scenario.actors must be an array (an empty array is fine).";

            foreach (var actor in data.actors)
            {
                if (actor == null) return "Scenario.actors contains a null entry.";
                if (string.IsNullOrEmpty(actor.visualId)) return "Every actor requires a non-empty visualId.";
                if (!IsVec3(actor.startPosition)) return $"Actor '{actor.visualId}': startPosition must have exactly 3 components.";
                if (!IsVec3(actor.endPosition)) return $"Actor '{actor.visualId}': endPosition must have exactly 3 components.";
                if (actor.endTime < actor.startTime) return $"Actor '{actor.visualId}': endTime cannot be before startTime.";
                if (actor.walkSpeed < 0f) return $"Actor '{actor.visualId}': walkSpeed cannot be negative.";
            }

            return null;
        }

        private static bool IsVec3(float[] arr) => arr != null && arr.Length == 3;
    }
}
