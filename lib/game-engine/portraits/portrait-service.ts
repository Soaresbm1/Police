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

/** Generates a stable colored-initials avatar as an inline SVG data URI —
 * no network call, no filesystem asset, fully deterministic per seed. */
export class DeterministicAvatarService implements PersonPortraitService {
  getPortraitUrl(seed: string, displayName: string): string {
    const hash = hashSeed(seed);
    const hue = hash % 360;
    const background = `hsl(${hue}, 42%, 28%)`;
    const foreground = `hsl(${hue}, 60%, 82%)`;
    const initials = initialsOf(displayName);

    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
      `<rect width="64" height="64" rx="8" fill="${background}" />` +
      `<text x="32" y="40" font-family="ui-monospace, monospace" font-size="24" font-weight="600" ` +
      `fill="${foreground}" text-anchor="middle">${initials}</text>` +
      `</svg>`;

    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }
}

export const portraitService: PersonPortraitService = new DeterministicAvatarService();
