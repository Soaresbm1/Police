import Link from "next/link";

const APPS = [
  { href: "/investigation/applications/telephonie", tag: "TEL", name: "Téléphonie", system: "SIRENE", desc: "Recherche par numéro — journal d'appels, SMS, localisation.", accent: "text-link border-link/40" },
  { href: "/investigation/applications/vehicules", tag: "VEH", name: "Véhicules", system: "OFROU", desc: "Registre cantonal des immatriculations.", accent: "text-success border-success/40" },
  { href: "/investigation/applications/casier", tag: "CAS", name: "Casier judiciaire", system: "CASIJUD", desc: "Antécédents judiciaires par personne.", accent: "text-warning border-warning/40" },
  { href: "/investigation/applications/cameras", tag: "VID", name: "Vidéosurveillance", system: "VIGIL", desc: "Réquisition de bandes par lieu et créneau.", accent: "text-[#a97fd9] border-[#a97fd9]/40" },
  { href: "/investigation/applications/banque", tag: "BAN", name: "Consultation bancaire", system: "FINMA-REQ", desc: "Relevés de compte — mandat requis.", accent: "text-warning border-warning/40" },
  { href: "/investigation/applications/mandats", tag: "MAN", name: "Mandats", system: "MP-CANTON", desc: "Suivi des réquisitions et mandats déposés.", accent: "text-danger border-danger/40" },
];

export default function ApplicationsHubPage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div>
        <p className="field-label">Terminal police cantonale</p>
        <h1 className="text-2xl font-bold uppercase tracking-wide text-foreground">Applications</h1>
        <p className="mt-1 text-sm text-muted">Chaque logiciel a ses propres accès et limites — certains nécessitent un mandat.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {APPS.map((app) => (
          <Link key={app.href} href={app.href} className={`panel group flex items-start gap-3 border-t-2 p-4 hover:border-t-2 ${app.accent}`}>
            <span className={`font-data flex h-9 w-12 shrink-0 items-center justify-center border text-xs tracking-wide ${app.accent}`}>
              {app.tag}
            </span>
            <div>
              <p className={`font-data text-[9px] uppercase tracking-[0.2em] ${app.accent.split(" ")[0]}`}>{app.system}</p>
              <p className="font-medium text-foreground group-hover:text-accent-strong">{app.name}</p>
              <p className="mt-0.5 text-xs text-muted">{app.desc}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
