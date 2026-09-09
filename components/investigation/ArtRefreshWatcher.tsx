"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Living Investigation System — Generated Art V2A.
 *
 * Fixes the "player never sees the pop-in" gap: every investigation page
 * resolves `getReadyPortraitUrls`/`getReadyCrimeSceneUrl` once, at Server
 * Component render time, with no automatic revalidation — a player who
 * lands on a page before background generation finishes stays on
 * procedural art forever, until an unrelated navigation happens to force
 * a fresh render of that route.
 *
 * Mount this with `pending` = "does the page I'm on still have at least
 * one generated asset it wants but doesn't have yet" (each page computes
 * this itself from data it already fetched — see the pages under
 * `app/investigation` and `app/dossiers/[id]`). If `pending` is false at
 * mount, this does nothing at all. If true, it performs at most two
 * bounded `router.refresh()` calls on fixed short delays, then stops
 * permanently for this mount — never an interval, never unbounded
 * polling, and never a third attempt even if still pending.
 *
 * `router.refresh()` only ever re-runs this page's Server Component,
 * which only ever calls the read-only lookups above — neither can start a
 * new Cloudflare generation (see `portrait-lookup.ts`/`scene-lookup.ts`'s
 * own doc comments: "structurally cannot trigger generation"), so this
 * can never cause a regeneration storm, no matter how many times a page
 * happens to mount this component.
 */
/** Exactly two fixed delays — the hard bound on how many `router.refresh()`
 * calls one mount can ever perform. Exported so a test can verify the
 * bound is structurally fixed at 2, without needing to render this
 * component (this codebase has no React-rendering test infrastructure). */
export const REFRESH_DELAYS_MS = [1750, 3500] as const;

export function ArtRefreshWatcher({ pending }: { pending: boolean }) {
  const router = useRouter();
  const startedRef = useRef(false);

  useEffect(() => {
    if (!pending || startedRef.current) return;
    startedRef.current = true;
    const timers = REFRESH_DELAYS_MS.map((delay) => setTimeout(() => router.refresh(), delay));
    return () => timers.forEach(clearTimeout);
  }, [pending, router]);

  return null;
}
