import { hashSeed, pick } from "@/lib/art/hash";

/**
 * Abstraction over how a person's portrait is produced. Today the only
 * implementation is a deterministic, generated avatar — no external image
 * generator is called (see project brief §34 and §43: no external API in
 * the core game path). A future `AiPortraitService` could implement this
 * same interface backed by a real image generator without any caller
 * needing to change; the contract only promises a stable, cacheable URL for
 * a given seed, and that the *same* seed always yields the *same* portrait
 * for the lifetime of a case.
 */
export interface PersonPortraitService {
  getPortraitUrl(seed: string, displayName: string): string;
}

function initialsOf(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "");
  return letters.join("") || "?";
}

type HairSilhouette = "short" | "shoulder" | "bun" | "bald" | "curly";

const HAIR_SILHOUETTES: HairSilhouette[] = ["short", "shoulder", "bun", "bald", "curly"];
const COLLAR_SHAPES: ("crew" | "collar" | "vneck")[] = ["crew", "collar", "vneck"];

function hairPath(style: HairSilhouette): string {
  switch (style) {
    case "bald":
      return "";
    case "shoulder":
      return `<path d="M18 16 C18 6 46 6 46 16 L48 40 C48 44 44 44 43 40 L41 20 C36 12 26 12 21 20 L19 40 C18 44 14 44 14 40 Z" fill="#ffffff" fill-opacity="0.16" />`;
    case "bun":
      return `<path d="M20 15 C20 6 44 6 44 15 L44 22 C36 16 28 16 20 22 Z" fill="#ffffff" fill-opacity="0.16" /><circle cx="32" cy="9" r="4" fill="#ffffff" fill-opacity="0.16" />`;
    case "curly":
      return `<circle cx="20" cy="16" r="6" fill="#ffffff" fill-opacity="0.15" /><circle cx="30" cy="11" r="7" fill="#ffffff" fill-opacity="0.15" /><circle cx="41" cy="16" r="6" fill="#ffffff" fill-opacity="0.15" /><circle cx="25" cy="20" r="5" fill="#ffffff" fill-opacity="0.15" /><circle cx="37" cy="20" r="5" fill="#ffffff" fill-opacity="0.15" />`;
    case "short":
    default:
      return `<path d="M19 21 C19 9 45 9 45 21 L44 15 C38 10 26 10 20 15 Z" fill="#ffffff" fill-opacity="0.16" />`;
  }
}

function collarPath(shape: (typeof COLLAR_SHAPES)[number]): string {
  switch (shape) {
    case "collar":
      return `<path d="M14 58 C14 44 28 44 32 46 C36 44 50 44 50 58 L44 58 L38 50 L32 56 L26 50 L20 58 Z" fill="#ffffff" fill-opacity="0.11" />`;
    case "vneck":
      return `<path d="M14 58 C14 44 50 44 50 58 L34 58 L32 50 L30 58 Z" fill="#ffffff" fill-opacity="0.11" />`;
    case "crew":
    default:
      return `<path d="M14 58 C14 44 50 44 50 58 Z" fill="#ffffff" fill-opacity="0.1" />`;
  }
}

/**
 * Generates a stable, monochrome "police database" ID portrait as an
 * inline SVG data URI — no network call, no filesystem asset, fully
 * deterministic per seed. Deliberately styled as a scanned dossier photo
 * (desaturated tone, corner registration ticks, faint scanlines, a fake ID
 * code) rather than a colorful chat-app avatar, so it reads as evidence
 * rather than a profile picture.
 *
 * Every shape below (hairstyle silhouette, collar cut, face proportions,
 * background tone) is derived purely from `seed` — never from anything
 * that could encode guilt (this function never receives a `Person`, a
 * role, or `CaseTruth`, so it has no way to bias a culprit's portrait even
 * by accident; see `lib/art/visual-manifest.ts` for the equivalent
 * guilt-safety guarantee on the richer descriptor path).
 */
export class DeterministicAvatarService implements PersonPortraitService {
  getPortraitUrl(seed: string, displayName: string): string {
    const hash = hashSeed(seed);
    const tone = 22 + (hash % 4) * 5;
    const background = `hsl(210, 8%, ${tone}%)`;
    const initials = initialsOf(displayName);
    const idCode = (hash % 900000).toString().padStart(6, "0");
    const hairStyle = pick(`${seed}:hair`, HAIR_SILHOUETTES);
    const collarShape = pick(`${seed}:collar`, COLLAR_SHAPES);
    const faceWidth = 10 + (hash % 3);

    const scanlines = Array.from({ length: 16 }, (_, i) => {
      const y = i * 4;
      return `<line x1="0" y1="${y}" x2="64" y2="${y}" stroke="#ffffff" stroke-opacity="0.025" />`;
    }).join("");

    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
      `<rect width="64" height="64" fill="${background}" />` +
      collarPath(collarShape) +
      `<circle cx="32" cy="24" r="${faceWidth}" fill="#ffffff" fill-opacity="0.14" />` +
      hairPath(hairStyle) +
      scanlines +
      `<text x="32" y="38" font-family="ui-monospace, monospace" font-size="15" font-weight="700" ` +
      `fill="#e8e6de" text-anchor="middle">${initials}</text>` +
      `<rect x="0.75" y="0.75" width="62.5" height="62.5" fill="none" stroke="#e8e6de" stroke-opacity="0.35" stroke-width="1.5" />` +
      `<path d="M1 7V1H7" stroke="#bb8a42" stroke-width="1.5" fill="none" />` +
      `<path d="M57 1H63V7" stroke="#bb8a42" stroke-width="1.5" fill="none" />` +
      `<path d="M63 57V63H57" stroke="#bb8a42" stroke-width="1.5" fill="none" />` +
      `<path d="M7 63H1V57" stroke="#bb8a42" stroke-width="1.5" fill="none" />` +
      `<text x="32" y="61" font-family="ui-monospace, monospace" font-size="6" letter-spacing="1" ` +
      `fill="#e8e6de" fill-opacity="0.55" text-anchor="middle">ID-${idCode}</text>` +
      `</svg>`;

    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }
}

export const portraitService: PersonPortraitService = new DeterministicAvatarService();
