import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentGame } from "@/lib/game-session/current";
import {
  getAlibi,
  getAlibiAssessment,
  getLocation,
  getPerson,
  getVisibleEvidenceForPerson,
} from "@/lib/game-session/player-view";
import { EvidenceCard } from "@/components/investigation/EvidenceCard";
import { formatGameTime } from "@/lib/game-engine/types/time";
import { Avatar } from "@/components/investigation/Avatar";

function AppLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="rounded border border-border-strong px-3 py-1.5 text-sm text-foreground hover:border-accent">
      {label} <span aria-hidden>→</span>
    </Link>
  );
}

export default async function PersonPage({ params }: { params: Promise<{ personId: string }> }) {
  const { personId } = await params;
  const game = await getCurrentGame();
  if (!game) return null;
  const { truth, session } = game;
  const person = getPerson(truth, personId);
  if (!person) notFound();

  const home = getLocation(truth, person.homeLocationId);
  const work = person.workLocationId ? getLocation(truth, person.workLocationId) : null;
  const alibi = getAlibi(truth, personId);
  const assessment = getAlibiAssessment(truth, session, personId);
  const evidence = getVisibleEvidenceForPerson(truth, session, personId);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <Avatar seed={person.avatarSeed} name={`${person.firstName} ${person.lastName}`} size={56} />
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">{person.isVictim ? "Victime" : person.isSuspect ? "Suspect" : "Témoin"}</p>
            <h1 className="text-2xl font-semibold text-foreground">
              {person.firstName} {person.lastName}
            </h1>
            <p className="mt-1 text-sm text-muted">
              {person.age} ans — {person.profession} — {person.sex === "male" ? "Homme" : "Femme"}
            </p>
          </div>
        </div>
        {!person.isVictim && (
          <Link
            href={`/investigation/interrogatoires/${person.id}`}
            className="rounded bg-accent px-4 py-2 text-sm font-medium text-background hover:bg-accent-strong"
          >
            Interroger
          </Link>
        )}
      </div>

      <section className="grid gap-4 rounded border border-border bg-surface p-5 md:grid-cols-3">
        <div>
          <h2 className="text-xs uppercase tracking-wide text-muted">Domicile</h2>
          <p className="mt-1 text-sm text-foreground">{home?.name}</p>
          <p className="text-xs text-muted">{home?.address}</p>
        </div>
        <div>
          <h2 className="text-xs uppercase tracking-wide text-muted">Lieu de travail</h2>
          <p className="mt-1 text-sm text-foreground">{work?.name ?? "—"}</p>
        </div>
        <div>
          <h2 className="text-xs uppercase tracking-wide text-muted">Téléphone</h2>
          <p className="font-data mt-1 text-sm text-foreground">{person.phoneNumber}</p>
        </div>
        {person.hasVehicle && (
          <div>
            <h2 className="text-xs uppercase tracking-wide text-muted">Véhicule</h2>
            <p className="font-data mt-1 text-sm text-foreground">{person.vehiclePlate}</p>
            <p className="text-xs text-muted">{person.vehicleDescription}</p>
          </div>
        )}
      </section>

      {alibi && (
        <section className="rounded border border-border bg-surface p-5">
          <h2 className="text-xs uppercase tracking-wide text-muted">Déclaration / alibi</h2>
          <p className="mt-2 text-sm text-foreground">« {alibi.claim} »</p>
          <p className="font-data mt-1 text-xs text-muted">
            Fenêtre concernée : {formatGameTime(alibi.windowStart)} – {formatGameTime(alibi.windowEnd)}
          </p>
          {assessment && (assessment.corroborating.length > 0 || assessment.contradicting.length > 0) && (
            <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
              {assessment.corroborating.length > 0 && (
                <p className="text-success">✓ {assessment.corroborating.length} élément(s) découvert(s) corroborent cette déclaration.</p>
              )}
              {assessment.contradicting.length > 0 && (
                <p className="text-danger">⚠ {assessment.contradicting.length} élément(s) découvert(s) contredisent cette déclaration.</p>
              )}
            </div>
          )}
        </section>
      )}

      {!person.isVictim && (
        <section className="rounded border border-border bg-surface p-5">
          <h2 className="text-xs uppercase tracking-wide text-muted">Consulter dans les applications</h2>
          <p className="mt-1 text-xs text-muted">Chaque outil a ses propres accès — certains nécessitent un mandat.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <AppLink href={`/investigation/applications/telephonie?tel=${encodeURIComponent(person.phoneNumber)}`} label="Téléphonie" />
            {person.hasVehicle && (
              <AppLink href={`/investigation/applications/vehicules?plate=${encodeURIComponent(person.vehiclePlate ?? "")}`} label="Véhicules" />
            )}
            <AppLink href={`/investigation/applications/casier?person=${person.id}`} label="Casier judiciaire" />
            <AppLink href={`/investigation/applications/cameras?location=${person.homeLocationId}`} label="Caméras — domicile" />
            {work && <AppLink href={`/investigation/applications/cameras?location=${work.id}`} label="Caméras — travail" />}
            <AppLink href={`/investigation/applications/banque?person=${person.id}`} label="Banque" />
            <AppLink href={`/investigation/applications/mandats?person=${person.id}`} label="Mandats" />
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-xs uppercase tracking-wide text-muted">Preuves liées ({evidence.length})</h2>
        {evidence.length === 0 ? (
          <p className="text-sm text-muted">Aucune preuve découverte impliquant cette personne pour l&apos;instant.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {evidence.map((ev) => (
              <EvidenceCard key={ev.id} evidence={ev} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
