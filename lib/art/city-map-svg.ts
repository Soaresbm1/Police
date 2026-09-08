import { DISTRICTS } from "@/lib/game-engine/world/city";
import { hashSeed } from "./hash";

const TOWN_SIZE_KM = 8;
const toPct = (km: number) => (km / TOWN_SIZE_KM) * 100;

const DISTRICT_HUES: Record<string, number> = {
  centre: 40,
  "vieille-ville": 25,
  rive: 200,
  tilleuls: 100,
  industrie: 230,
  hauts: 280,
};

function roadGrid(): string {
  // A small, fixed set of "major" roads (fewer, thicker) and "secondary"
  // roads (more, thinner) — deterministic, not tied to any generated
  // location, purely to make the city read as a place with streets.
  const major = [18, 50, 82];
  const secondary = [8, 30, 40, 62, 72, 92];
  const lines: string[] = [];
  for (const p of major) {
    lines.push(`<line x1="${p}" y1="0" x2="${p}" y2="100" stroke="#e8e6de" stroke-opacity="0.1" stroke-width="0.6" />`);
    lines.push(`<line x1="0" y1="${p}" x2="100" y2="${p}" stroke="#e8e6de" stroke-opacity="0.1" stroke-width="0.6" />`);
  }
  for (const p of secondary) {
    lines.push(`<line x1="${p}" y1="0" x2="${p}" y2="100" stroke="#e8e6de" stroke-opacity="0.045" stroke-width="0.3" />`);
    lines.push(`<line x1="0" y1="${p}" x2="100" y2="${p}" stroke="#e8e6de" stroke-opacity="0.045" stroke-width="0.3" />`);
  }
  return lines.join("");
}

function landmarkIcon(x: number, y: number, seed: string): string {
  // A tiny generic building/landmark glyph — flavor only, not a real
  // generated location (those are drawn as markers by InvestigationMap
  // itself, on top of this static background).
  const variant = hashSeed(seed) % 3;
  if (variant === 0) return `<rect x="${x - 1.2}" y="${y - 1.8}" width="2.4" height="3.6" fill="#e8e6de" fill-opacity="0.12" />`;
  if (variant === 1) return `<circle cx="${x}" cy="${y}" r="1.6" fill="none" stroke="#e8e6de" stroke-opacity="0.15" stroke-width="0.4" />`;
  return `<path d="M ${x - 1.6} ${y + 1.4} L ${x} ${y - 1.6} L ${x + 1.6} ${y + 1.4} Z" fill="#e8e6de" fill-opacity="0.1" />`;
}

/**
 * Vironval as a stylized city map — district shapes, a believable road
 * grid, and a handful of flavor landmarks. Purely cosmetic background
 * geometry: the city's district *bounds* are the real, engine-defined
 * ones (`lib/game-engine/world/city.ts`); generated location markers are
 * drawn on top of this by `InvestigationMap.tsx` using the same
 * percentage coordinate system, so a marker always sits inside its
 * correct district's shape.
 *
 * The city's layout never changes between cases, so this is computed
 * once at module load rather than per request.
 */
function buildCityMapSvg(): string {
  const districtShapes = DISTRICTS.map((d) => {
    const x = toPct(d.bounds.minX);
    const y = toPct(d.bounds.minY);
    const w = toPct(d.bounds.maxX - d.bounds.minX);
    const h = toPct(d.bounds.maxY - d.bounds.minY);
    const hue = DISTRICT_HUES[d.id] ?? 210;
    const cx = x + w / 2;
    const cy = y + h / 2;
    return (
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="hsl(${hue}, 18%, 10%)" fill-opacity="0.5" stroke="#e8e6de" stroke-opacity="0.06" stroke-width="0.3" />` +
      landmarkIcon(cx + (hashSeed(d.id) % 5) - 2, cy + (hashSeed(d.id + "y") % 5) - 2, d.id) +
      `<text x="${cx}" y="${y + 3.5}" font-family="ui-monospace, monospace" font-size="2.6" fill="#8c8f97" text-anchor="middle" letter-spacing="0.05">${d.name.toUpperCase()}</text>`
    );
  }).join("");

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none">` +
    `<rect width="100" height="100" fill="#100e0c" />` +
    districtShapes +
    roadGrid() +
    `</svg>`
  );
}

let cached: string | null = null;

export function cityMapSvg(): string {
  if (!cached) cached = buildCityMapSvg();
  return cached;
}

export function cityMapSvgDataUri(): string {
  return `data:image/svg+xml,${encodeURIComponent(cityMapSvg())}`;
}
