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

function hashSeed(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function initialsOf(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "");
  return letters.join("") || "?";
}

/** Generates a stable, monochrome "police database" ID portrait as an inline
 * SVG data URI — no network call, no filesystem asset, fully deterministic
 * per seed. Deliberately styled as a scanned dossier photo (desaturated
 * tone, corner registration ticks, faint scanlines, a fake ID code) rather
 * than a colorful chat-app avatar, so it reads as evidence rather than a
 * profile picture. */
export class DeterministicAvatarService implements PersonPortraitService {
  getPortraitUrl(seed: string, displayName: string): string {
    const hash = hashSeed(seed);
    const tone = 24 + (hash % 3) * 6;
    const background = `hsl(210, 8%, ${tone}%)`;
    const initials = initialsOf(displayName);
    const idCode = (hash % 900000).toString().padStart(6, "0");

    const scanlines = Array.from({ length: 16 }, (_, i) => {
      const y = i * 4;
      return `<line x1="0" y1="${y}" x2="64" y2="${y}" stroke="#ffffff" stroke-opacity="0.025" />`;
    }).join("");

    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
      `<rect width="64" height="64" fill="${background}" />` +
      `<circle cx="32" cy="24" r="11" fill="#ffffff" fill-opacity="0.14" />` +
      `<path d="M14 58 C14 44 50 44 50 58 Z" fill="#ffffff" fill-opacity="0.1" />` +
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
