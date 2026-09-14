namespace Caseline.CCTV
{
    /// <summary>
    /// Phase U4.2 — pure, static, environment-keyed field-of-view lookup.
    /// The bridge JSON has no FOV field (see
    /// <c>lib/art/unity-cctv-bridge.ts</c>) — camera field of view is a
    /// Unity-only rendering parameter, kept out of the schema entirely
    /// since <see cref="CCTVSceneController"/> already receives the
    /// environment `scene` kind it needs to key off of. Every value here
    /// is a fixed constant chosen alongside the matching
    /// <c>CAMERA_PRESETS</c> distance in the TS bridge so the actor reads
    /// at roughly 15-30% of frame height without the camera behaving like
    /// anything but a fixed surveillance lens: narrower (tighter) for the
    /// more confined corridor, progressively wider for shop/generic/
    /// parking/street, which read as more open spaces where a slightly
    /// smaller actor is expected and acceptable.
    /// </summary>
    public static class CCTVCameraFraming
    {
        private const float CorridorFov = 50f;
        private const float ShopFov = 55f;
        private const float GenericFov = 57f;
        private const float ParkingFov = 62f;
        private const float StreetFov = 65f;

        /// <summary>Same input always yields the same output — no
        /// randomness, no time, no CaseTruth. Falls back to the generic
        /// framing for any kind it doesn't recognize (mirrors
        /// <see cref="CCTVEnvironmentController.Build"/>'s own "unknown
        /// kind falls back to generic" rule) rather than an arbitrary or
        /// extreme value.</summary>
        public static float FieldOfViewForKind(string environmentKind)
        {
            switch (environmentKind)
            {
                case "corridor": return CorridorFov;
                case "shop": return ShopFov;
                case "parking": return ParkingFov;
                case "street": return StreetFov;
                case "generic":
                default: return GenericFov;
            }
        }
    }
}
