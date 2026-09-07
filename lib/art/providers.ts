/**
 * Art provider interfaces — the seam between gameplay and however a piece
 * of visual content is actually produced. Every provider here follows the
 * same contract as the original `PersonPortraitService`
 * (`lib/game-engine/portraits/portrait-service.ts`, kept where it is since
 * callers already depend on it): given a deterministic seed and enough
 * descriptive context, return a stable, cacheable image URL — nothing about
 * *how* that URL is produced is exposed to the caller.
 *
 * Today every implementation here is procedural (inline SVG data URIs, no
 * network call, no file on disk), matching the project's "no AI dependency
 * in the core game path" rule (see ARCHITECTURE.md). A future
 * `AiCrimeSceneImageProvider` or similar can implement the same interface
 * — swapping `defaultCrimeSceneImageProvider` for it is the only change
 * needed anywhere in the app; no gameplay or layout code depends on how
 * the image was made.
 */

// ---------------------------------------------------------------------
// Crime scene backgrounds
// ---------------------------------------------------------------------

export interface CrimeSceneImageProvider {
  /** A background image for the spatial crime-scene screen
   * (`CrimeSceneScreen.tsx`), themed by location type. */
  getSceneBackground(locationType: string, seed: string): string;
}

function hashSeed(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

class ProceduralCrimeSceneImageProvider implements CrimeSceneImageProvider {
  getSceneBackground(locationType: string, seed: string): string {
    const hue = hashSeed(`${locationType}:${seed}`) % 360;
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">` +
      `<rect width="400" height="300" fill="hsl(${hue}, 8%, 8%)" />` +
      `<rect x="20" y="20" width="360" height="260" fill="none" stroke="hsl(${hue}, 10%, 20%)" stroke-width="2" />` +
      `</svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }
}

export const defaultCrimeSceneImageProvider: CrimeSceneImageProvider = new ProceduralCrimeSceneImageProvider();

// ---------------------------------------------------------------------
// Evidence photographs
// ---------------------------------------------------------------------

export interface EvidenceImageProvider {
  /** A representative photograph/scan for one evidence item, themed by its
   * family (physical/digital/video/financial/testimonial) and type. */
  getEvidenceImage(family: string, type: string, seed: string): string;
}

const FAMILY_TONE: Record<string, number> = {
  physical: 30,
  digital: 210,
  video: 270,
  financial: 140,
  testimonial: 45,
};

class ProceduralEvidenceImageProvider implements EvidenceImageProvider {
  getEvidenceImage(family: string, type: string, seed: string): string {
    const hue = FAMILY_TONE[family] ?? 0;
    const variance = hashSeed(`${type}:${seed}`) % 20;
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 140">` +
      `<rect width="200" height="140" fill="hsl(${hue}, 20%, ${12 + variance}%)" />` +
      `<rect x="6" y="6" width="188" height="128" fill="none" stroke="hsl(${hue}, 30%, 40%)" stroke-dasharray="4 3" />` +
      `</svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }
}

export const defaultEvidenceImageProvider: EvidenceImageProvider = new ProceduralEvidenceImageProvider();

// ---------------------------------------------------------------------
// CCTV frames
// ---------------------------------------------------------------------

export interface CCTVFrameProvider {
  /** A single still frame for a camera_footage evidence entry, themed by
   * camera id and in-game timestamp (so the same shot is always the same
   * frame — no per-render randomness). */
  getFrame(cameraId: string, timestamp: number): string;
}

class ProceduralCCTVFrameProvider implements CCTVFrameProvider {
  getFrame(cameraId: string, timestamp: number): string {
    const brightness = 6 + (hashSeed(`${cameraId}:${timestamp}`) % 10);
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180">` +
      `<rect width="320" height="180" fill="hsl(0, 0%, ${brightness}%)" />` +
      `<rect width="320" height="180" fill="none" stroke="#3a2020" stroke-width="1" />` +
      `</svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }
}

export const defaultCCTVFrameProvider: CCTVFrameProvider = new ProceduralCCTVFrameProvider();

// ---------------------------------------------------------------------
// Location exteriors/interiors (map + location detail views)
// ---------------------------------------------------------------------

export interface LocationImageProvider {
  getLocationImage(locationType: string, seed: string): string;
}

class ProceduralLocationImageProvider implements LocationImageProvider {
  getLocationImage(locationType: string, seed: string): string {
    const hue = hashSeed(`${locationType}:${seed}`) % 360;
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 160">` +
      `<rect width="240" height="160" fill="hsl(${hue}, 12%, 14%)" />` +
      `</svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }
}

export const defaultLocationImageProvider: LocationImageProvider = new ProceduralLocationImageProvider();
