export interface NavLink {
  href: string;
  tag: string;
  label: string;
}

export interface NavSection {
  caption: string;
  links: NavLink[];
}

/**
 * Single source of truth for the investigation nav tree — the desktop
 * rail (`AppRail`), the mobile bottom bar, and the mobile "Plus" drawer
 * (`MobileNav`) all read from this instead of each keeping their own
 * copy, so a link added/renamed here shows up everywhere consistently.
 */
export const NAV_SECTIONS: NavSection[] = [
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

export const ACCUSATION_LINK: NavLink = { href: "/investigation/accusation", tag: "ACU", label: "Procéder à l'accusation" };

/** The 4 destinations that get a permanent slot in the mobile bottom bar
 * — the rest (plus Activité/Accusation, surfaced with more weight than a
 * plain link) live behind the bar's 5th "Plus" tab. Picked to match the
 * explicit "easy access" list: case/dashboard, people, evidence, apps —
 * activity and accusation get their own prominent treatment inside the
 * drawer instead of competing for one of only 5 slots. */
export const MOBILE_PRIMARY_LINKS: NavLink[] = [
  { href: "/investigation/affaire", tag: "DOS", label: "Dossier" },
  { href: "/investigation/suspects", tag: "SUS", label: "Personnes" },
  { href: "/investigation/preuves", tag: "PRV", label: "Preuves" },
  { href: "/investigation/applications", tag: "APP", label: "Apps" },
];
