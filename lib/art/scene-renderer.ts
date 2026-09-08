import { getLayout, type SceneShape } from "./crime-scene-layouts";
import { lightingPalette } from "./lighting";
import type { CrimeSceneVisualDescriptor } from "./visual-manifest";
import { hashSeed } from "./hash";

function shapeToSvg(shape: SceneShape, hue: number, lightness: number): string {
  const fill = `hsl(${hue}, 14%, ${lightness}%)`;
  const opacity = shape.opacity ?? 0.4;
  if (shape.kind === "rect") {
    return `<rect x="${shape.x}" y="${shape.y}" width="${shape.w}" height="${shape.h}" fill="${fill}" fill-opacity="${opacity}" filter="url(#scene-shadow)" />`;
  }
  if (shape.kind === "ellipse") {
    return `<ellipse cx="${shape.cx}" cy="${shape.cy}" rx="${shape.rx}" ry="${shape.ry}" fill="${fill}" fill-opacity="${opacity}" />`;
  }
  return `<path d="${shape.d}" fill="${fill}" fill-opacity="${opacity}" />`;
}

/**
 * Builds a full-bleed, illustrated crime-scene background as an inline SVG
 * (100x100 viewBox, matching the percentage-based hotspot coordinate
 * system already used by `getCrimeSceneHotspots`). Deliberately a
 * stylized graphic-novel/forensic-illustration treatment — layered
 * silhouettes, a lighting wash, a subtle cross-hatch grain — rather than
 * an attempt at fake photorealism (req. 7).
 */
export function buildCrimeSceneSvg(descriptor: CrimeSceneVisualDescriptor): string {
  const layout = getLayout(descriptor.layoutTemplate);
  const palette = lightingPalette(descriptor.timeOfDay);
  const seedNum = hashSeed(descriptor.seed);
  const grainSeed = seedNum % 7;

  const floorFill = `hsl(${layout.floorHue}, 10%, ${palette.floorLightness}%)`;
  const wallFill = `hsl(${layout.wallHue}, 12%, ${palette.wallLightness}%)`;
  const lampColor = palette.warmTint ? "#e8b25a" : "#cfd8e8";

  const furnitureSvg = layout.furniture.map((s) => shapeToSvg(s, layout.wallHue, palette.wallLightness + 6)).join("");

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none">` +
    `<defs>` +
    `<filter id="scene-shadow" x="-20%" y="-20%" width="140%" height="140%">` +
    `<feDropShadow dx="0.4" dy="0.8" stdDeviation="0.6" flood-color="#000000" flood-opacity="0.45" />` +
    `</filter>` +
    `<pattern id="scene-grain-${grainSeed}" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(${grainSeed * 12})">` +
    `<line x1="0" y1="0" x2="0" y2="3" stroke="#ffffff" stroke-opacity="0.03" stroke-width="0.5" />` +
    `</pattern>` +
    `<radialGradient id="scene-lamp" cx="50%" cy="30%" r="70%">` +
    `<stop offset="0%" stop-color="${lampColor}" stop-opacity="${palette.warmTint ? 0.16 : 0.08}" />` +
    `<stop offset="100%" stop-color="${lampColor}" stop-opacity="0" />` +
    `</radialGradient>` +
    `</defs>` +
    // Back wall.
    `<rect x="0" y="0" width="100" height="100" fill="${wallFill}" />` +
    // Floor plane (perspective trapezoid, wider at the bottom).
    `<path d="M 12 40 L 88 40 L 100 100 L 0 100 Z" fill="${floorFill}" />` +
    // Furniture silhouettes.
    furnitureSvg +
    // Lamp/ambient light wash.
    `<rect x="0" y="0" width="100" height="100" fill="url(#scene-lamp)" />` +
    // Illustration grain overlay.
    `<rect x="0" y="0" width="100" height="100" fill="url(#scene-grain-${grainSeed})" />` +
    // Ambient darkening for evening/night scenes — evidence markers sit
    // above this layer in the DOM, so readability is never affected.
    `<rect x="0" y="0" width="100" height="100" fill="#000000" fill-opacity="${palette.ambientOpacity}" />` +
    // Vignette.
    `<rect x="0" y="0" width="100" height="100" fill="none" stroke="#000000" stroke-opacity="0.5" stroke-width="10" />` +
    `</svg>`
  );
}

export function crimeSceneSvgDataUri(descriptor: CrimeSceneVisualDescriptor): string {
  return `data:image/svg+xml,${encodeURIComponent(buildCrimeSceneSvg(descriptor))}`;
}
