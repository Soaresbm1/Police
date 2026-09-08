export type TimeOfDay = "day" | "evening" | "night";

/**
 * Shared mood parameters so the crime scene, city map, and CCTV renderers
 * stay visually consistent with each other for the same time of day,
 * without each one re-deriving its own lighting logic. Evidence and
 * document text always renders on a fixed high-contrast surface
 * regardless of this palette — mood never comes at the cost of
 * readability (req. 17).
 */
export interface LightingPalette {
  wallLightness: number;
  floorLightness: number;
  /** 0-1 opacity of a dark ambient overlay drawn on top of the scene. */
  ambientOpacity: number;
  /** Warm lamp-light tint (evening/night indoor scenes) vs. a cool,
   * neutral daylight tint. */
  warmTint: boolean;
}

const PALETTE: Record<TimeOfDay, LightingPalette> = {
  day: { wallLightness: 24, floorLightness: 18, ambientOpacity: 0, warmTint: false },
  evening: { wallLightness: 16, floorLightness: 11, ambientOpacity: 0.18, warmTint: true },
  night: { wallLightness: 9, floorLightness: 6, ambientOpacity: 0.4, warmTint: true },
};

export function lightingPalette(timeOfDay: TimeOfDay): LightingPalette {
  return PALETTE[timeOfDay];
}
