"use client";

import { useEffect, useRef } from "react";
import { playSound } from "@/lib/sound/sound-manager";

/**
 * Plays the existing "notify" tone exactly once whenever the ready-and-
 * unseen event count increases since the last render — i.e. only when
 * time actually advances and one or more events cross into `ready`, never
 * once per event (five events becoming ready in one `+4H` jump still
 * plays a single tone). Purely a client-side UI effect: it never mutates
 * session/gameplay state, and `playSound` already respects the mute
 * setting on its own.
 *
 * `null` on first mount is deliberate — it establishes a baseline instead
 * of firing immediately just because some events happened to already be
 * ready+unseen when this page loaded (e.g. a fresh page load, a resumed
 * session).
 */
export function EventNotificationSound({ readyUnseenCount }: { readyUnseenCount: number }) {
  const previousCount = useRef<number | null>(null);

  useEffect(() => {
    if (previousCount.current !== null && readyUnseenCount > previousCount.current) {
      playSound("notify");
    }
    previousCount.current = readyUnseenCount;
  }, [readyUnseenCount]);

  return null;
}
