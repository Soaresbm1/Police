"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ACCUSATION_LINK, MOBILE_PRIMARY_LINKS, NAV_SECTIONS, type NavLink } from "./navigation";
import { endCurrentCase } from "@/lib/game-session/actions";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";

/**
 * Mobile replacement for the desktop left rail (`AppRail`) — a permanent
 * 208px sidebar makes no sense once there isn't 208px of width to spare.
 * Bottom tab bar (4 primary destinations + "Plus") plus a slide-up
 * drawer for everything else, both reading the SAME `NAV_SECTIONS`
 * config the desktop rail uses, so nothing here is a second copy of the
 * nav tree. `lg:hidden` throughout — the desktop rail takes over at the
 * same breakpoint this disappears at (see `GameShell.tsx`).
 */
export function MobileNav({ readyUnseenEvents }: { readyUnseenEvents: number }) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Closes the drawer automatically on navigation rather than leaving it
  // open over the new screen — the React-recommended "adjust state
  // during render" pattern (see react.dev), not an effect: comparing
  // against the previous render's pathname and updating both pieces of
  // state together, synchronously, before this render is painted.
  const [lastPathname, setLastPathname] = useState(pathname);
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setDrawerOpen(false);
  }
  useBodyScrollLock(drawerOpen);

  const isActive = (href: string) => pathname === href || pathname?.startsWith(href + "/");
  const drawerHasActiveItem = NAV_SECTIONS.some((s) => s.links.some((l) => !MOBILE_PRIMARY_LINKS.some((p) => p.href === l.href) && isActive(l.href)));

  return (
    <>
      {drawerOpen && (
        // `touch-none` here (not on the panel) is what stops the dimmed
        // backdrop itself from ever acting as a pan surface — without it,
        // a touch that starts on the backdrop can still bubble into a
        // native scroll/rubber-band of whatever is behind, even with the
        // body scroll lock below (iOS treats `overflow: hidden` on body
        // as advisory for touch-driven scrolling, not authoritative).
        <div
          className="fixed inset-0 z-40 flex touch-none flex-col justify-end bg-background-deep/80 lg:hidden"
          onClick={() => setDrawerOpen(false)}
        >
          {/* The fixed drawer shell itself is deliberately NOT the scroll
             container — it only sizes/positions via flex + max-height.
             Only the inner region below scrolls, so the shell can never
             be dragged/panned as if it were a bottom sheet. */}
          <div className="pb-sheet-safe panel panel-bracketed flex max-h-[80dvh] flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
              <p className="field-label">Navigation</p>
              <button type="button" onClick={() => setDrawerOpen(false)} className="btn btn-ghost !px-2 !py-1 !text-xs" aria-label="Fermer le menu">
                ✕
              </button>
            </div>

            {/* The ONLY scrollable region: vertical scroll only
               (`touch-pan-y` — a diagonal drag resolves as vertical, a
               purely horizontal one does nothing), and `overscroll-contain`
               stops reaching the top/bottom from chaining into a bounce
               on the page behind. */}
            <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto overflow-x-hidden overscroll-contain">
              <Link
                href="/investigation/activite"
                className="flex items-center justify-between gap-2 border-b border-border px-4 py-3 text-sm text-foreground"
              >
                <span className="flex items-center gap-2.5">
                  <span className="font-data flex h-8 w-11 shrink-0 items-center justify-center border border-border-strong text-[10px] tracking-wide text-muted-dim">
                    ACT
                  </span>
                  Activité
                </span>
                {readyUnseenEvents > 0 && (
                  <span className="flex h-5 min-w-5 items-center justify-center border border-accent-strong bg-accent-dim/20 px-1 font-data text-[11px] text-accent-strong">
                    {readyUnseenEvents}
                  </span>
                )}
              </Link>
              <div className="flex flex-col gap-3 p-4">
                {NAV_SECTIONS.map((section) => (
                  <div key={section.caption} className="flex flex-col gap-0.5">
                    <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-dim">{section.caption}</p>
                    {section.links
                      .filter((link) => link.href !== "/investigation/activite")
                      .map((link) => (
                        <DrawerItem key={link.href} link={link} active={isActive(link.href)} />
                      ))}
                  </div>
                ))}
              </div>
              <div className="flex flex-col gap-2 border-t border-border p-4">
                <Link
                  href={ACCUSATION_LINK.href}
                  className="flex min-h-11 items-center justify-center gap-2 border border-danger/50 py-3 text-[12px] font-semibold uppercase tracking-[0.14em] text-danger transition-colors hover:bg-danger-bg"
                >
                  {ACCUSATION_LINK.label}
                </Link>
                <form action={endCurrentCase}>
                  <button type="submit" className="btn btn-ghost min-h-11 w-full !text-[11px] hover:!text-danger">
                    Quitter l&apos;enquête
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}

      <nav
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-surface pb-[var(--safe-bottom)] lg:hidden"
        style={{ height: "calc(var(--mobile-nav-height) + var(--safe-bottom))" }}
        aria-label="Navigation principale"
      >
        {MOBILE_PRIMARY_LINKS.map((link) => (
          <TabItem key={link.href} link={link} active={isActive(link.href)} />
        ))}
        <button
          type="button"
          onClick={() => setDrawerOpen((v) => !v)}
          className={`relative flex flex-1 flex-col items-center justify-center gap-1 text-[10px] uppercase tracking-wide transition-colors ${
            drawerOpen || drawerHasActiveItem ? "text-accent-strong" : "text-muted"
          }`}
          aria-label="Plus de fonctions"
          aria-expanded={drawerOpen}
        >
          {readyUnseenEvents > 0 && !drawerOpen && (
            <span className="absolute right-[22%] top-1.5 h-1.5 w-1.5 bg-accent-strong" aria-hidden />
          )}
          <span
            className={`font-data flex h-6 w-9 items-center justify-center border text-[10px] tracking-wide ${
              drawerOpen || drawerHasActiveItem ? "border-accent-strong" : "border-border-strong text-muted-dim"
            }`}
          >
            •••
          </span>
          Plus
        </button>
      </nav>
    </>
  );
}

function TabItem({ link, active }: { link: NavLink; active: boolean }) {
  return (
    <Link
      href={link.href}
      className={`flex flex-1 flex-col items-center justify-center gap-1 text-[10px] uppercase tracking-wide transition-colors ${
        active ? "text-accent-strong" : "text-muted"
      }`}
    >
      <span
        className={`font-data flex h-6 w-9 items-center justify-center border text-[10px] tracking-wide ${
          active ? "border-accent-strong" : "border-border-strong text-muted-dim"
        }`}
      >
        {link.tag}
      </span>
      {link.label}
    </Link>
  );
}

function DrawerItem({ link, active }: { link: NavLink; active: boolean }) {
  return (
    <Link
      href={link.href}
      className={`flex min-h-11 items-center gap-2.5 border-l-2 px-3 py-2.5 transition-colors ${
        active ? "border-accent bg-surface-raised text-foreground" : "border-transparent text-muted"
      }`}
    >
      <span
        className={`font-data flex h-8 w-11 shrink-0 items-center justify-center border text-[10px] tracking-wide ${
          active ? "border-accent text-accent-strong" : "border-border-strong text-muted-dim"
        }`}
      >
        {link.tag}
      </span>
      <span className="text-[13px] uppercase tracking-wide">{link.label}</span>
    </Link>
  );
}
