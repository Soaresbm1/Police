"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface RailLink {
  href: string;
  tag: string;
  label: string;
}

interface RailSection {
  caption: string;
  links: RailLink[];
}

const SECTIONS: RailSection[] = [
  {
    caption: "Enquête",
    links: [
      { href: "/investigation/affaire", tag: "DOS", label: "Dossier" },
      { href: "/investigation/scene", tag: "SCN", label: "Scène" },
      { href: "/investigation/suspects", tag: "SUS", label: "Suspects" },
      { href: "/investigation/temoins", tag: "TEM", label: "Témoins" },
      { href: "/investigation/preuves", tag: "PRV", label: "Preuves" },
      { href: "/investigation/laboratoire", tag: "LAB", label: "Laboratoire" },
      { href: "/investigation/activite", tag: "ACT", label: "Activité" },
    ],
  },
  {
    caption: "Outils",
    links: [
      { href: "/investigation/applications", tag: "APP", label: "Applications" },
      { href: "/investigation/carte", tag: "CAR", label: "Carte" },
      { href: "/investigation/tableau", tag: "TAB", label: "Tableau" },
      { href: "/investigation/chronologie", tag: "CHR", label: "Chronologie" },
      { href: "/investigation/relations", tag: "REL", label: "Relations" },
      { href: "/investigation/notes", tag: "NOT", label: "Notes" },
    ],
  },
];

function RailItem({ link, active }: { link: RailLink; active: boolean }) {
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
        {SECTIONS.map((section) => (
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
          href="/investigation/accusation"
          className="flex items-center justify-center gap-2 border border-danger/50 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-danger transition-colors hover:bg-danger-bg"
        >
          Procéder à l&apos;accusation
        </Link>
      </div>
    </nav>
  );
}
