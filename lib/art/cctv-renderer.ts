import type { CCTVFrameDescriptor } from "./cctv";
import { formatGameTime } from "@/lib/game-engine/types/time";
import { hashSeed, pickRange } from "./hash";

const QUALITY_BRIGHTNESS: Record<CCTVFrameDescriptor["visibilityQuality"], number> = {
  clear: 22,
  partial: 17,
  obstructed: 13,
  low_light: 8,
  distant: 15,
};

const QUALITY_NOISE: Record<CCTVFrameDescriptor["visibilityQuality"], number> = {
  clear: 0.02,
  partial: 0.04,
  obstructed: 0.07,
  low_light: 0.09,
  distant: 0.05,
};

function silhouette(x: number, identifiable: boolean, seed: string): string {
  const height = pickRange(`${seed}:h`, 60, 90);
  const headR = height * 0.14;
  const y = 170 - height;
  const opacity = identifiable ? 0.55 : 0.3;
  const blur = identifiable ? "" : ` filter="url(#cctv-smudge)"`;
  return (
    `<g fill="#0a0a0a" fill-opacity="${opacity}"${blur}>` +
    `<circle cx="${x}" cy="${y}" r="${headR}" />` +
    `<path d="M ${x - headR * 1.4} ${y + headR} Q ${x} ${y + height * 0.55} ${x + headR * 1.4} ${y + headR} L ${x + headR * 1.6} 170 L ${x - headR * 1.6} 170 Z" />` +
    `</g>`
  );
}

/**
 * Renders one CCTV still as an inline SVG. Visibility strictly follows
 * `descriptor.visibilityQuality`/`identifiable` — identifying silhouette
 * detail only appears when the descriptor says the frame actually
 * supports it (req. 10-11); otherwise every figure renders as a
 * deliberately featureless, blurred smudge, and no `visiblePersonIds`
 * data is available to draw from in the first place.
 */
export function buildCCTVFrameSvg(descriptor: CCTVFrameDescriptor, personCountHint = 1): string {
  const brightness = QUALITY_BRIGHTNESS[descriptor.visibilityQuality];
  const noise = QUALITY_NOISE[descriptor.visibilityQuality];
  const seedBase = `${descriptor.cameraId}:${descriptor.timestamp}`;
  const count = descriptor.identifiable ? Math.max(1, descriptor.visiblePersonIds.length) : personCountHint;
  const positions = Array.from({ length: Math.min(count, 3) }, (_, i) =>
    pickRange(`${seedBase}:pos${i}`, 60 + i * 90, 90 + i * 90),
  );

  const noiseId = `cctv-noise-${hashSeed(seedBase) % 5}`;
  const silhouettes = positions.map((x, i) => silhouette(x, descriptor.identifiable, `${seedBase}:${i}`)).join("");

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180">` +
    `<defs>` +
    `<filter id="cctv-smudge"><feGaussianBlur stdDeviation="2.4" /></filter>` +
    `<filter id="${noiseId}"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="1" stitchTiles="stitch" result="n" /><feColorMatrix in="n" type="saturate" values="0" /></filter>` +
    `</defs>` +
    `<rect width="320" height="180" fill="hsl(0, 0%, ${brightness}%)" />` +
    // Floor line.
    `<line x1="0" y1="170" x2="320" y2="170" stroke="#000000" stroke-opacity="0.4" />` +
    silhouettes +
    // Grain/noise overlay, opacity scaled by visibility quality.
    `<rect width="320" height="180" filter="url(#${noiseId})" opacity="${noise}" />` +
    // Scanlines.
    `<g opacity="0.06">${Array.from({ length: 45 }, (_, i) => `<line x1="0" y1="${i * 4}" x2="320" y2="${i * 4}" stroke="#ffffff" stroke-width="1" />`).join("")}</g>` +
    // Frame border + burn-in text.
    `<rect x="0.5" y="0.5" width="319" height="179" fill="none" stroke="#3a2020" stroke-width="1" />` +
    `<text x="8" y="16" font-family="ui-monospace, monospace" font-size="10" fill="#c9a23d" opacity="0.85">${descriptor.cameraId}</text>` +
    `<text x="8" y="172" font-family="ui-monospace, monospace" font-size="9" fill="#c9a23d" opacity="0.85">${formatGameTime(descriptor.timestamp)}</text>` +
    `<circle cx="304" cy="12" r="3" fill="#d33" opacity="0.9" />` +
    `<text x="290" y="16" font-family="ui-monospace, monospace" font-size="8" fill="#d33" text-anchor="end" opacity="0.9">REC</text>` +
    `</svg>`
  );
}

export function cctvFrameDataUri(descriptor: CCTVFrameDescriptor, personCountHint = 1): string {
  return `data:image/svg+xml,${encodeURIComponent(buildCCTVFrameSvg(descriptor, personCountHint))}`;
}
