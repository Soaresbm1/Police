using NUnit.Framework;
using UnityEngine;
using static Caseline.Reconstruction.ReconstructionLabelLayout;

namespace Caseline.Reconstruction.Tests
{
    public class ReconstructionLabelLayoutTests
    {
        private const float Lane = 20f;

        [Test]
        public void NonOverlappingLabels_StayExactlyWhereRequested()
        {
            var a = new Rect(0, 50, 60, 18);
            var b = new Rect(200, 50, 60, 18);
            var placed = Resolve(new[] { new LabelRequest("a", a), new LabelRequest("b", b) }, Lane);
            Assert.AreEqual(a, placed[0]);
            Assert.AreEqual(b, placed[1]);
        }

        [Test]
        public void OverlappingLabel_MovesUpOneLane_AndNoLongerOverlaps()
        {
            var victim = new Rect(100, 50, 70, 18);
            var person = new Rect(140, 50, 80, 18);
            var placed = Resolve(new[] { new LabelRequest("victim", victim), new LabelRequest("person", person) }, Lane);

            Assert.AreEqual(victim, placed[0], "the leftmost label keeps its place");
            Assert.AreEqual(person.y - Lane, placed[1].y);
            Assert.IsFalse(placed[0].Overlaps(placed[1]));
        }

        [Test]
        public void LabelsOnlyEverMoveVertically()
        {
            var rects = new[] { new Rect(100, 50, 70, 18), new Rect(110, 52, 70, 18), new Rect(120, 49, 70, 18) };
            var placed = Resolve(new[] { new LabelRequest("a", rects[0]), new LabelRequest("b", rects[1]), new LabelRequest("c", rects[2]) }, Lane);
            for (var i = 0; i < rects.Length; i++) Assert.AreEqual(rects[i].x, placed[i].x);
        }

        [Test]
        public void CoincidentLabels_EachGetTheirOwnLane()
        {
            var same = new Rect(100, 50, 70, 18);
            var placed = Resolve(new[] { new LabelRequest("a", same), new LabelRequest("b", same), new LabelRequest("c", same) }, Lane);
            for (var i = 0; i < placed.Length; i++)
            {
                for (var j = i + 1; j < placed.Length; j++) Assert.IsFalse(placed[i].Overlaps(placed[j]), $"{i} overlaps {j}");
            }
        }

        [Test]
        public void Placement_DoesNotDependOnTheOrderActorsWereListed()
        {
            var same = new Rect(100, 50, 70, 18);
            var forward = Resolve(new[] { new LabelRequest("victim", same), new LabelRequest("person", same) }, Lane);
            var reversed = Resolve(new[] { new LabelRequest("person", same), new LabelRequest("victim", same) }, Lane);
            Assert.AreEqual(forward[0], reversed[1]);
            Assert.AreEqual(forward[1], reversed[0]);
        }
    }
}
