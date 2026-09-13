using Caseline.CCTV;
using NUnit.Framework;

namespace Caseline.CCTV.Tests
{
    public class CCTVJsonLoaderTests
    {
        private const string ValidJson = @"{
            ""scene"": ""parking"",
            ""camera"": { ""id"": ""CAM-01"", ""position"": [0,4.5,-6], ""rotation"": [20,0,0] },
            ""durationSeconds"": 15,
            ""actors"": [
                { ""visualId"": ""actor-1"", ""identified"": false, ""startTime"": 1.5, ""endTime"": 12.0,
                  ""startPosition"": [-4,0,3], ""endPosition"": [4,0,3], ""walkSpeed"": 1.4 }
            ]
        }";

        [Test]
        public void ValidJson_Parses()
        {
            var ok = CCTVJsonLoader.TryLoad(ValidJson, out var data, out var error);
            Assert.IsTrue(ok, error);
            Assert.IsNotNull(data);
            Assert.AreEqual("CAM-01", data.camera.id);
            Assert.AreEqual(1, data.actors.Length);
            Assert.AreEqual("actor-1", data.actors[0].visualId);
        }

        [Test]
        public void EmptyString_FailsSafely()
        {
            var ok = CCTVJsonLoader.TryLoad("", out var data, out var error);
            Assert.IsFalse(ok);
            Assert.IsNull(data);
            Assert.IsNotEmpty(error);
        }

        [Test]
        public void GarbageJson_FailsSafelyWithoutThrowing()
        {
            Assert.DoesNotThrow(() =>
            {
                var ok = CCTVJsonLoader.TryLoad("{ this is not valid json ][", out var data, out var error);
                Assert.IsFalse(ok);
            });
        }

        [Test]
        public void MissingCamera_FailsValidation()
        {
            const string json = @"{ ""scene"":""parking"", ""durationSeconds"": 10, ""actors"": [] }";
            var ok = CCTVJsonLoader.TryLoad(json, out _, out var error);
            Assert.IsFalse(ok);
            StringAssert.Contains("camera", error);
        }

        [Test]
        public void ZeroDuration_FailsValidation()
        {
            const string json = @"{
                ""camera"": { ""id"":""CAM-01"", ""position"":[0,0,0], ""rotation"":[0,0,0] },
                ""durationSeconds"": 0,
                ""actors"": []
            }";
            var ok = CCTVJsonLoader.TryLoad(json, out _, out var error);
            Assert.IsFalse(ok);
            StringAssert.Contains("durationSeconds", error);
        }

        [Test]
        public void ActorEndTimeBeforeStartTime_FailsValidation()
        {
            const string json = @"{
                ""camera"": { ""id"":""CAM-01"", ""position"":[0,0,0], ""rotation"":[0,0,0] },
                ""durationSeconds"": 10,
                ""actors"": [
                    { ""visualId"":""actor-1"", ""startTime"": 5, ""endTime"": 1,
                      ""startPosition"":[0,0,0], ""endPosition"":[1,0,0], ""walkSpeed"": 1 }
                ]
            }";
            var ok = CCTVJsonLoader.TryLoad(json, out _, out var error);
            Assert.IsFalse(ok);
            StringAssert.Contains("endTime", error);
        }

        [Test]
        public void ActorMissingVisualId_FailsValidation()
        {
            const string json = @"{
                ""camera"": { ""id"":""CAM-01"", ""position"":[0,0,0], ""rotation"":[0,0,0] },
                ""durationSeconds"": 10,
                ""actors"": [
                    { ""startTime"": 0, ""endTime"": 1, ""startPosition"":[0,0,0], ""endPosition"":[1,0,0] }
                ]
            }";
            var ok = CCTVJsonLoader.TryLoad(json, out _, out var error);
            Assert.IsFalse(ok);
            StringAssert.Contains("visualId", error);
        }
    }
}
