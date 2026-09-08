"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * A fast, subtle fade on every screen change (workstation → crime scene →
 * interrogation → accusation → reveal, etc.) — reuses the existing
 * `.fade-up` CSS animation rather than a new transition library (none is
 * in `package.json`, and none is needed for something this small).
 * Keying on the pathname forces a fresh mount per navigation so the
 * animation re-triggers; `.fade-up` itself already respects both
 * `prefers-reduced-motion` and the in-game reduce-motion setting (see
 * `app/globals.css`), so this never fights that preference.
 */
export function ScreenTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="fade-up">
      {children}
    </div>
  );
}
