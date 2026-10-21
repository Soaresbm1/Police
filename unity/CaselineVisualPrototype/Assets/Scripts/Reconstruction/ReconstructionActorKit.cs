using UnityEngine;

namespace Caseline.Reconstruction
{
    /// <summary>
    /// The optional character kit: textured people standing in for the blockout mannequin. Like the scenery kit
    /// (<see cref="ReconstructionOfficeKit"/>) it is installed locally only, because the art's licence forbids
    /// redistributing it; without it every actor is the mannequin, exactly as before.
    ///
    /// Which character stands for an actor is a fixed table keyed ONLY on the actor's <c>genericAppearance</c>
    /// ("category_tone", e.g. "workwear_dark"): never the role, visual id, person, sex, age or any case data. Two actors
    /// with the same genericAppearance therefore get the same character, as they got the same tint before. Because
    /// the pack's characters are each male or female, that choice is NOT a likeness of the person it stands for; the
    /// viewer's disclaimer says appearances are indicative.
    /// </summary>
    public static class ReconstructionActorKit
    {
        /// <summary>Set to false to force the mannequin (tests that measure the mannequin itself use this).</summary>
        public static bool Enabled = true;

        public const string ResourceFolder = "OfficeKit/Actors/";

        // Office workers only: no security guard, cleaner or boss, whose outfit would say something about who the person
        // is. Rows are clothing categories (casual, formal, workwear, outerwear); columns the tones (dark, light, neutral).
        public static readonly string[][] CharacterTable =
        {
            new[] { "SM_Chr_Developer_Male_01", "SM_Chr_Developer_Female_01", "SM_Chr_Developer_Male_02" },
            new[] { "SM_Chr_Business_Male_01", "SM_Chr_Business_Female_01", "SM_Chr_Business_Male_02" },
            new[] { "SM_Chr_Business_Male_03", "SM_Chr_Developer_Female_02", "SM_Chr_Business_Female_02" },
            new[] { "SM_Chr_Business_Female_03", "SM_Chr_Business_Male_04", "SM_Chr_Business_Female_04" },
        };

        private static readonly string[] Categories = { "casual", "formal", "workwear", "outerwear" };
        private static readonly string[] Tones = { "dark", "light", "neutral" };

        /// <summary>The kit character for a genericAppearance, or null for anything this table does not know.</summary>
        public static string CharacterFor(string genericAppearance)
        {
            if (string.IsNullOrEmpty(genericAppearance)) return null;
            var split = genericAppearance.IndexOf('_');
            if (split <= 0) return null;
            var category = System.Array.IndexOf(Categories, genericAppearance.Substring(0, split));
            var tone = System.Array.IndexOf(Tones, genericAppearance.Substring(split + 1));
            if (category < 0 || tone < 0) return null;
            return CharacterTable[category][tone];
        }

        /// <summary>Instantiates the kit actor for <paramref name="genericAppearance"/> under <paramref name="parent"/>,
        /// or returns null (use the mannequin) when the kit is disabled, not installed, or the appearance is unknown.</summary>
        public static GameObject TryCreate(string genericAppearance, Transform parent)
        {
            if (!Enabled) return null;
            var character = CharacterFor(genericAppearance);
            if (character == null) return null;
            var prefab = Resources.Load<GameObject>(ResourceFolder + character + "_Actor");
            return prefab == null ? null : Object.Instantiate(prefab, parent);
        }

        /// <summary>True when the kit's actors are installed on this machine / shipped in this build.</summary>
        public static bool IsAvailable => Resources.Load<GameObject>(ResourceFolder + CharacterTable[0][0] + "_Actor") != null;
    }
}
