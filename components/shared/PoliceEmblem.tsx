import { CITY } from "@/lib/game-engine/world/city";

/**
 * A small fictional badge for `CITY.policeDepartment` — deliberately
 * generic/heraldic (a ring, a star, a banner) rather than modeled on any
 * real department's protected insignia. Renders in `currentColor` so it
 * inherits whatever accent the caller sets.
 */
export function PoliceEmblem({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} className={className} role="img" aria-label={CITY.policeDepartment}>
      <circle cx="24" cy="24" r="21" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="24" cy="24" r="16" fill="none" stroke="currentColor" strokeWidth="0.8" opacity="0.5" />
      <path
        d="M24 10 L27 20 L37 20 L29 26 L32 36 L24 30 L16 36 L19 26 L11 20 L21 20 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <text x="24" y="43.5" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="4.2" letterSpacing="0.5" fill="currentColor">
        {CITY.name.toUpperCase()}
      </text>
    </svg>
  );
}
