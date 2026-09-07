"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/investigation/affaire", label: "Affaire" },
  { href: "/investigation/suspects", label: "Suspects" },
  { href: "/investigation/temoins", label: "Témoins" },
  { href: "/investigation/preuves", label: "Preuves" },
  { href: "/investigation/tableau", label: "Tableau" },
  { href: "/investigation/chronologie", label: "Chronologie" },
  { href: "/investigation/relations", label: "Relations" },
  { href: "/investigation/notes", label: "Notes" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5">
      {LINKS.map((link) => {
        const active = pathname === link.href || pathname?.startsWith(link.href + "/");
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`rounded px-3 py-2 text-sm transition-colors ${
              active ? "bg-accent/15 text-accent-strong font-medium" : "text-muted hover:bg-surface-raised hover:text-foreground"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
      <Link
        href="/investigation/accusation"
        className="mt-3 rounded border border-danger/40 px-3 py-2 text-sm text-danger hover:bg-danger-bg"
      >
        Accusation
      </Link>
    </nav>
  );
}
