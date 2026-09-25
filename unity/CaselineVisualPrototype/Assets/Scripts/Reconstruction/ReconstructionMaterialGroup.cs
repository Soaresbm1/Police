using UnityEngine;

namespace Caseline.Reconstruction
{
    /// <summary>
    /// U5.6 iteration 3/4 — the restrained value band a Reconstruction actor renderer belongs to, so the actor reads as
    /// a mannequin with distinct head / torso / pelvis / limbs at the ACTUAL viewer distance instead of one flat-tinted
    /// mass. Values are appended (never reordered) so serialized scenes keep their meaning.
    /// </summary>
    public enum ReconstructionMaterialBand
    {
        Head,
        Torso,
        Limb,
        Hand,
        Pelvis,
        Joint,
    }

    /// <summary>
    /// Reconstruction-only marker attached by <c>ReconstructionActorVisualPolish</c> (Editor-only, on Reconstruction's own
    /// actor instance — CCTV's actor never gets it). <see cref="ReconstructionActorController"/> reads it to derive each
    /// renderer's tint from the SAME `genericAppearance` base tint. Nothing here can see a role, visualId or any
    /// identity-shaped value: two actors with the same genericAppearance always get identical materials.
    /// </summary>
    public class ReconstructionMaterialGroup : MonoBehaviour
    {
        public ReconstructionMaterialBand band;

        // Iteration 3 scaled the base tint by x0.85..x1.12; the base tint is ~0.16 (very dark), so that was only a
        // ~0.02 value change — invisible at player distance. Iteration 4 instead lifts each band a fixed fraction of the
        // way toward white, which produces a visible, monotone value ladder for dark/neutral/light appearances alike:
        // torso (anchor, base) < pelvis < joint < arms/legs < hands < head.
        public static float Lift(ReconstructionMaterialBand band) => band switch
        {
            ReconstructionMaterialBand.Head => 0.34f,
            ReconstructionMaterialBand.Hand => 0.26f,
            ReconstructionMaterialBand.Limb => 0.20f,
            ReconstructionMaterialBand.Joint => 0.16f,
            ReconstructionMaterialBand.Pelvis => 0.12f,
            _ => 0f, // Torso
        };

        public static Color BandTint(Color baseTint, ReconstructionMaterialBand band)
        {
            var c = Color.Lerp(baseTint, Color.white, Lift(band));
            c.a = baseTint.a;
            return c;
        }
    }
}
