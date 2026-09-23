using UnityEngine;

namespace Caseline.Reconstruction
{
    /// <summary>
    /// U5.6 iteration 3 — a Reconstruction-only marker that tells
    /// <see cref="ReconstructionActorController.ApplyGenericAppearance"/> which restrained value band a renderer
    /// belongs to (head / torso / limb), so the actor reads as more than one flat-tinted block at gameplay camera
    /// distance. Attached only by <c>ReconstructionActorVisualPolish</c> (Editor-only, Reconstruction's own actor
    /// instance) — CCTV's actor never gets this component, so its renderers keep the single flat tint they always
    /// had, unaffected.
    ///
    /// Every band is a fixed multiplier applied to the SAME `genericAppearance`-derived base tint
    /// (<see cref="ReconstructionAppearanceUtil.ToneTint"/>) — there is no branch anywhere on role, visualId or any
    /// other identity-shaped field, so two actors with the same `genericAppearance` always end up pixel-identical
    /// regardless of role.
    /// </summary>
    public enum ReconstructionMaterialBand
    {
        Head,
        Torso,
        Limb,
    }

    public class ReconstructionMaterialGroup : MonoBehaviour
    {
        public ReconstructionMaterialBand band;

        // Multiplicative, not additive, so it scales correctly across the dark/base/light genericAppearance
        // variants alike (a fixed additive offset would clip or vanish depending on the base tint's brightness).
        // Head is subtly lighter (reads as the "cap" of the silhouette), limbs subtly darker (visually recedes
        // slightly behind the torso, the visual mass the eye should anchor on first) — values chosen small enough
        // to stay clearly non-photorealistic and never approach a skin-tone read.
        public static float Multiplier(ReconstructionMaterialBand band) => band switch
        {
            ReconstructionMaterialBand.Head => 1.12f,
            ReconstructionMaterialBand.Torso => 1.0f,
            ReconstructionMaterialBand.Limb => 0.85f,
            _ => 1.0f,
        };
    }
}
