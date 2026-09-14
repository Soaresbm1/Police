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
    /// at roughly 18-25% of frame height around the center of the walking
    /// path, without the camera behaving like anything but a fixed
    /// surveillance lens.
    ///
    /// Phase U4.3 — <c>ParkingFov</c>/<c>ShopFov</c>/<c>GenericFov</c>
    /// narrowed alongside the matching TS-side distance increase (see
    /// that file's doc comment): the deterministic occupancy tooling
    /// (<see cref="CCTVFramingMeasurement"/>/<c>CCTVFramingReport</c>)
    /// found those three corner-mounted cameras swung to ~40%+ occupancy
    /// at the near end of the walking path even though their center
    /// occupancy was already correct — narrowing the lens as the camera
    /// moves back holds the center steady while flattening that swing.
    /// <c>CorridorFov</c>/<c>StreetFov</c> unchanged (corridor was already
    /// flat across the whole path; street's distance was retuned instead
    /// of its FOV).
    ///
    /// A first pass narrowed all three corner cameras by the same ~12°
    /// (matching the same ~30% dolly-back applied to all three — see the
    /// TS bridge's doc comment). Re-measuring afterward showed that
    /// uniform narrowing helped <c>parking</c> (max occupancy dropped from
    /// ~40% to ~29%) but not <c>shop</c>/<c>generic</c>, whose near-end
    /// spike stayed roughly the same or slightly worsened — the simple
    /// "occupancy ~ 1/(distance*tan(FOV/2))" formula assumes the actor
    /// sits on the camera's optical axis, which breaks down for these
    /// 45°-yaw corner shots since the walking path's near end is
    /// increasingly off-axis, not just closer. Per the explicit
    /// instruction to trust actual rendered/measured framing over the
    /// formula, <c>ShopFov</c> and <c>GenericFov</c> were widened back a
    /// few degrees (not narrowed further) and re-measured directly with
    /// the projection-based tool until the near-end spike visibly
    /// improved without pushing center-of-path occupancy out of the
    /// 18-25% band — <c>ShopFov</c> 44°→48° (max 37.4%→33.9%),
    /// <c>GenericFov</c> 45°→49° (max 36.2%→32.9%). This is a genuine
    /// improvement, not a full fix: all three corner cameras still show a
    /// near-end spike above the ~25% ceiling because they are physically
    /// mounted close to that end of the path — see the U4.3 report for
    /// this documented as a remaining limitation rather than claimed as
    /// resolved.
    /// </summary>
    public static class CCTVCameraFraming
    {
        private const float CorridorFov = 50f;
        private const float ShopFov = 48f;
        private const float GenericFov = 49f;
        private const float ParkingFov = 50f;
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
