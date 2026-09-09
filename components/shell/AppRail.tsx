"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ACCUSATION_LINK, NAV_SECTIONS, type NavLink } from "./navigation";

function RailItem({ link, active }: { link: NavLink; active: boolean }) {
  return (
    <Link
      href={link.href}
      className={`group relative flex items-center gap-2.5 border-l-2 px-3 py-2 transition-colors ${
        active
          ? "border-accent bg-surface-raised text-foreground"
          : "border-transparent text-muted hover:border-border-strong hover:bg-surface-raised/60 hover:text-foreground"
      }`}
    >
      <span
        className={`font-data flex h-6 w-9 shrink-0 items-center justify-center border text-[10px] tracking-wide ${
          active ? "border-accent text-accent-strong" : "border-border-strong text-muted-dim group-hover:text-muted"
        }`}
      >
        {link.tag}
      </span>
      <span className="text-[13px] uppercase tracking-wide">{link.label}</span>
    </Link>
  );
}

export function AppRail() {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname?.startsWith(href + "/");

  return (
    <nav className="flex h-full flex-col justify-between overflow-y-auto bg-surface">
      <div className="flex flex-col gap-4 py-4">
        {NAV_SECTIONS.map((section) => (
          <div key={section.caption} className="flex flex-col gap-0.5">
            <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-dim">
              {section.caption}
            </p>
            {section.links.map((link) => (
              <RailItem key={link.href} link={link} active={isActive(link.href)} />
            ))}
          </div>
        ))}
      </div>
      <div className="border-t border-border p-3">
        <Link
          href={ACCUSATION_LINK.href}
          className="flex items-center justify-center gap-2 border border-danger/50 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-danger transition-colors hover:bg-danger-bg"
        >
          Procéder à l&apos;accusation
        </Link>
      </div>
    </nav>
  );
}
