"use client";

import { useEffect } from "react";

/**
 * Locks page scroll while a mobile bottom sheet/drawer is open. A
 * fixed-position overlay already blocks *clicks* on whatever is behind
 * it, but iOS Safari can still rubber-band/scroll the underlying page on
 * a touch drag that starts over the dimmed backdrop rather than the
 * sheet's own scrollable content — this closes that one real gap
 * without pulling in a modal/dialog library for it.
 */
export function useBodyScrollLock(locked: boolean): void {
  useEffect(() => {
    if (!locked) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [locked]);
}
