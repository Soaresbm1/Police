using Caseline.Reconstruction;
using NUnit.Framework;

namespace Caseline.Reconstruction.Tests
{
    public class ReconstructionJsonLoaderTests
    {
        private const string ValidJson = @"{
            ""version"": 1,
            ""caseId"": ""case-123"",
            ""environment"": ""generic"",
            ""durationSeconds"": 100,
            ""actors"": [
                {
                    ""visualId"": ""actor_a"",
                    ""roleForReconstruction"": ""culprit"",
                    ""genericAppearance"": ""casual_dark"",
                    ""spawnTime"": 0,
                    ""despawnTime"": 100,
                    ""waypoints"": [{""time"": 0, ""slot"": ""interaction""}, {""time"": 50, ""slot"": ""crime_point""}]
                },
                {
                    ""visualId"": ""actor_b"",
                    ""roleForReconstruction"": ""victim"",
                    ""genericAppearance"": ""formal_light"",
                    ""spawnTime"": 0,
                    ""despawnTime"": 50,
                    ""waypoints"": [{""time"": 0, ""slot"": ""interaction""}]
                }
            ],
            ""events"": [
                {""time"": 0, ""type"": ""talk"", ""actorVisualId"": ""actor_a"", ""counterpartyVisualId"": ""actor_b"", ""locationSlot"": ""interaction""},
                {""time"": 50, ""type"": ""attack"", ""actorVisualId"": ""actor_a"", ""counterpartyVisualId"": ""actor_b"", ""locationSlot"": ""crime_point"", ""safeVisualAction"": ""attack_strike""}
            ]
        }";

        [Test]
        public void ValidScenario_LoadsSuccessfully()
        {
            var ok = ReconstructionJsonLoader.TryLoad(ValidJson, out var data, out var error);
            Assert.IsTrue(ok, error);
            Assert.AreEqual(1, data.version);
            Assert.AreEqual("case-123", data.caseId);
            Assert.AreEqual(2, data.actors.Count);
            Assert.AreEqual(2, data.events.Count);
        }

        [Test]
        public void EmptyJson_IsRejected()
        {
            Assert.IsFalse(ReconstructionJsonLoader.TryLoad("", out _, out var error));
            Assert.IsNotNull(error);
        }

        [Test]
        public void MalformedJson_IsRejectedWithoutThrowing()
        {
            Assert.DoesNotThrow(() => ReconstructionJsonLoader.TryLoad("{ not valid json", out _, out _));
            Assert.IsFalse(ReconstructionJsonLoader.TryLoad("{ not valid json", out _, out var error));
            Assert.IsNotNull(error);
        }

        [Test]
        public void MissingVersion_IsRejected()
        {
            var json = ValidJson.Replace("\"version\": 1,", "");
            Assert.IsFalse(ReconstructionJsonLoader.TryLoad(json, out _, out var error));
            StringAssert.Contains("version", error);
        }

        [Test]
        public void UnknownVersion_IsRejected()
        {
            var json = ValidJson.Replace("\"version\": 1,", "\"version\": 2,");
            Assert.IsFalse(ReconstructionJsonLoader.TryLoad(json, out _, out var error));
            StringAssert.Contains("version", error);
        }

        [Test]
        public void MalformedActorReference_IsRejected()
        {
            var json = ValidJson.Replace("\"actorVisualId\": \"actor_a\", \"counterpartyVisualId\": \"actor_b\", \"locationSlot\": \"interaction\"", "\"actorVisualId\": \"actor_ghost\", \"counterpartyVisualId\": \"actor_b\", \"locationSlot\": \"interaction\"");
            Assert.IsFalse(ReconstructionJsonLoader.TryLoad(json, out _, out var error));
            StringAssert.Contains("actorVisualId", error);
        }

        [Test]
        public void MalformedCounterpartyReference_IsRejected()
        {
            var json = ValidJson.Replace("\"counterpartyVisualId\": \"actor_b\", \"locationSlot\": \"interaction\"", "\"counterpartyVisualId\": \"actor_ghost\", \"locationSlot\": \"interaction\"");
            Assert.IsFalse(ReconstructionJsonLoader.TryLoad(json, out _, out var error));
            StringAssert.Contains("counterpartyVisualId", error);
        }

        [Test]
        public void NegativeActorTime_IsRejected()
        {
            var json = ValidJson.Replace("\"spawnTime\": 0,\n                    \"despawnTime\": 100,", "\"spawnTime\": -5,\n                    \"despawnTime\": 100,");
            Assert.IsFalse(ReconstructionJsonLoader.TryLoad(json, out _, out var error));
        }

        [Test]
        public void NegativeEventTime_IsRejected()
        {
            var json = ValidJson.Replace("{\"time\": 0, \"type\": \"talk\"", "{\"time\": -1, \"type\": \"talk\"");
            Assert.IsFalse(ReconstructionJsonLoader.TryLoad(json, out _, out var error));
        }

        [Test]
        public void EventTimeBeyondDuration_IsRejected()
        {
            var json = ValidJson.Replace("\"durationSeconds\": 100,", "\"durationSeconds\": 40,");
            Assert.IsFalse(ReconstructionJsonLoader.TryLoad(json, out _, out var error));
        }

        [Test]
        public void UnknownRole_IsRejected()
        {
            var json = ValidJson.Replace("\"roleForReconstruction\": \"culprit\"", "\"roleForReconstruction\": \"mastermind\"");
            Assert.IsFalse(ReconstructionJsonLoader.TryLoad(json, out _, out var error));
            StringAssert.Contains("role", error);
        }

        [Test]
        public void UnknownEventType_IsRejected()
        {
            var json = ValidJson.Replace("\"type\": \"attack\"", "\"type\": \"murder\"");
            Assert.IsFalse(ReconstructionJsonLoader.TryLoad(json, out _, out var error));
            StringAssert.Contains("event type", error);
        }

        [Test]
        public void UnknownSlot_IsRejected()
        {
            var json = ValidJson.Replace("\"locationSlot\": \"crime_point\"", "\"locationSlot\": \"basement\"");
            Assert.IsFalse(ReconstructionJsonLoader.TryLoad(json, out _, out var error));
            StringAssert.Contains("locationSlot", error);
        }

        [Test]
        public void UnknownWaypointSlot_IsRejected()
        {
            var json = ValidJson.Replace("{\"time\": 50, \"slot\": \"crime_point\"}", "{\"time\": 50, \"slot\": \"basement\"}");
            Assert.IsFalse(ReconstructionJsonLoader.TryLoad(json, out _, out var error));
            StringAssert.Contains("slot", error);
        }

        [Test]
        public void DuplicateVisualIds_AreRejected()
        {
            var json = ValidJson.Replace("\"visualId\": \"actor_b\"", "\"visualId\": \"actor_a\"");
            Assert.IsFalse(ReconstructionJsonLoader.TryLoad(json, out _, out var error));
            StringAssert.Contains("Duplicate", error);
        }

        [Test]
        public void EmptyActorSet_IsRejected()
        {
            const string json = @"{
                ""version"": 1,
                ""caseId"": ""case-123"",
                ""environment"": ""generic"",
                ""durationSeconds"": 100,
                ""actors"": [],
                ""events"": []
            }";
            Assert.IsFalse(ReconstructionJsonLoader.TryLoad(json, out _, out var error));
        }

        // --- Truth-safety: unknown/forbidden fields must never be silently ignored ---

        [Test]
        public void UnknownTopLevelField_culpritId_IsRejected()
        {
            var json = ValidJson.Replace("\"version\": 1,", "\"version\": 1,\n            \"culpritId\": \"p_123\",");
            Assert.IsFalse(ReconstructionJsonLoader.TryLoad(json, out _, out var error));
            StringAssert.Contains("Unexpected field", error);
        }

        [Test]
        public void UnknownTopLevelField_victimId_IsRejected()
        {
            var json = ValidJson.Replace("\"version\": 1,", "\"version\": 1,\n            \"victimId\": \"p_456\",");
            Assert.IsFalse(ReconstructionJsonLoader.TryLoad(json, out _, out var error));
        }

        [Test]
        public void UnknownTopLevelField_seed_IsRejected()
        {
            var json = ValidJson.Replace("\"version\": 1,", "\"version\": 1,\n            \"seed\": \"CASE-ABCDEF\",");
            Assert.IsFalse(ReconstructionJsonLoader.TryLoad(json, out _, out var error));
        }

        [Test]
        public void UnknownTopLevelField_motive_IsRejected()
        {
            var json = ValidJson.Replace("\"version\": 1,", "\"version\": 1,\n            \"motive\": {\"type\": \"jealousy\"},");
            Assert.IsFalse(ReconstructionJsonLoader.TryLoad(json, out _, out var error));
        }

        [Test]
        public void UnknownTopLevelField_evidence_IsRejected()
        {
            var json = ValidJson.Replace("\"version\": 1,", "\"version\": 1,\n            \"evidence\": [],");
            Assert.IsFalse(ReconstructionJsonLoader.TryLoad(json, out _, out var error));
        }

        [Test]
        public void UnknownTopLevelField_relationships_IsRejected()
        {
            var json = ValidJson.Replace("\"version\": 1,", "\"version\": 1,\n            \"relationships\": [],");
            Assert.IsFalse(ReconstructionJsonLoader.TryLoad(json, out _, out var error));
        }

        [Test]
        public void UnknownTopLevelField_CaseTruth_IsRejected()
        {
            var json = ValidJson.Replace("\"version\": 1,", "\"version\": 1,\n            \"CaseTruth\": {},");
            Assert.IsFalse(ReconstructionJsonLoader.TryLoad(json, out _, out var error));
        }

        [Test]
        public void UnknownNestedActorField_personId_IsRejected()
        {
            var json = ValidJson.Replace("\"visualId\": \"actor_a\",", "\"visualId\": \"actor_a\",\n                    \"personId\": \"p_999\",");
            Assert.IsFalse(ReconstructionJsonLoader.TryLoad(json, out _, out var error));
            StringAssert.Contains("Unexpected field", error);
        }

        [Test]
        public void UnknownNestedEventField_isCrimeEvent_IsRejected()
        {
            var json = ValidJson.Replace("\"locationSlot\": \"crime_point\", \"safeVisualAction\": \"attack_strike\"", "\"locationSlot\": \"crime_point\", \"safeVisualAction\": \"attack_strike\", \"isCrimeEvent\": true");
            Assert.IsFalse(ReconstructionJsonLoader.TryLoad(json, out _, out var error));
        }

        [Test]
        public void CounterpartyVisualId_IsOptional()
        {
            var json = ValidJson.Replace(", \"counterpartyVisualId\": \"actor_b\"", "");
            var ok = ReconstructionJsonLoader.TryLoad(json, out var data, out var error);
            Assert.IsTrue(ok, error);
            Assert.IsNull(data.events[0].counterpartyVisualId);
        }
    }
}
