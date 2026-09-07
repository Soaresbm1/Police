import Link from "next/link";

const APPS = [
  { href: "/investigation/applications/telephonie", icon: "☎", name: "Téléphonie", desc: "Recherche par numéro — journal d'appels, SMS, localisation.", accent: "text-link" },
  { href: "/investigation/applications/vehicules", icon: "🚗", name: "Véhicules", desc: "Registre cantonal des immatriculations.", accent: "text-success" },
  { href: "/investigation/applications/casier", icon: "📁", name: "Casier judiciaire", desc: "Antécédents judiciaires par personne.", accent: "text-warning" },
  { href: "/investigation/applications/cameras", icon: "🎥", name: "Vidéosurveillance", desc: "Réquisition de bandes par lieu et créneau.", accent: "text-[#a97fd9]" },
  { href: "/investigation/applications/banque", icon: "🏦", name: "Consultation bancaire", desc: "Relevés de compte — mandat requis.", accent: "text-warning" },
  { href: "/investigation/applications/mandats", icon: "⚖", name: "Mandats", desc: "Suivi des réquisitions et mandats déposés.", accent: "text-danger" },
];

export default function ApplicationsHubPage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Applications</h1>
        <p className="mt-1 text-sm text-muted">Logiciels de la police cantonale — chaque outil a ses propres accès et limites.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {APPS.map((app) => (
          <Link
            key={app.href}
            href={app.href}
            className="flex items-start gap-3 rounded border border-border bg-surface p-4 transition-colors hover:border-accent"
          >
            <span className={`text-2xl ${app.accent}`}>{app.icon}</span>
            <div>
              <p className="font-medium text-foreground">{app.name}</p>
              <p className="text-xs text-muted">{app.desc}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
