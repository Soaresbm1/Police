using System;
using UnityEngine;

namespace Caseline.CCTV
{
    /// <summary>
    /// Plain data model for the JSON-driven CCTV demo (Phase U1 proof of
    /// concept). Deliberately carries ONLY visual facts a renderer needs —
    /// see the module doc on <see cref="CCTVJsonLoader"/> for the truth-safe
    /// design rationale. There is no culprit id, motive, evidence relevance,
    /// or any other CaseTruth-shaped field anywhere in this file, on
    /// purpose: this prototype exists to prove Unity can render "actor-1
    /// walks from A to B", nothing more.
    ///
    /// Vectors are plain <c>float[3]</c> arrays (not <see cref="Vector3"/>)
    /// so the JSON on disk matches the brief's own example
    /// (<c>"position": [0.0, 4.5, -6.0]</c>) exactly — Unity's
    /// <see cref="JsonUtility"/> serializes a Vector3 as an object
    /// (<c>{"x":...,"y":...,"z":...}</c>), not an array, so this is the one
    /// schema adaptation the brief itself invited ("Adapt the schema if
    /// Unity serialization requires it."). <see cref="CCTVVectorUtil"/>
    /// converts arrays to <see cref="Vector3"/> defensively.
    /// </summary>
    [Serializable]
    public class CCTVCameraData
    {
        public string id;
        public float[] position;
        public float[] rotation;
    }

    [Serializable]
    public class CCTVActorData
    {
        public string visualId;

        /// <summary>
        /// Mirrors CASELINE's own truth-safe `identifiable` boolean — never
        /// a person id or name. Present purely so the prototype's overlay
        /// can demonstrate the same "identified vs anonymous" visual
        /// distinction the real CCTV renderer already respects; this field
        /// carries no actual person data.
        /// </summary>
        public bool identified;

        public float startTime;
        public float endTime;
        public float[] startPosition;
        public float[] endPosition;

        /// <summary>
        /// Meters/second — cosmetic pacing only. Never read as anything
        /// evidentiary; it exists purely to keep the walk-cycle stride
        /// visually plausible for a given travel speed.
        /// </summary>
        public float walkSpeed = 1.4f;
    }

    [Serializable]
    public class CCTVScenarioData
    {
        public string scene;
        public CCTVCameraData camera;
        public float durationSeconds;
        public CCTVActorData[] actors;
    }

    /// <summary>Defensive float[3] → Vector3 conversion — never throws on a
    /// malformed/missing array; falls back to <see cref="Vector3.zero"/> so
    /// a bad JSON value degrades to "actor doesn't move" rather than a
    /// crash (see <see cref="CCTVJsonLoader"/> for the surrounding
    /// validation, which is where a malformed scenario is actually caught
    /// and reported before this is ever reached).</summary>
    public static class CCTVVectorUtil
    {
        public static Vector3 ToVector3(float[] arr)
        {
            if (arr == null || arr.Length != 3) return Vector3.zero;
            return new Vector3(arr[0], arr[1], arr[2]);
        }
    }
}
