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
import { CharacterPortrait } from "@/components/investigation/CharacterPortrait";
import { getReadyPortraitUrls } from "@/lib/art/generation/portrait-lookup";

function AppLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="btn !justify-between !text-[11px]">
      <span>{label}</span>
      <span aria-hidden>→</span>
    </Link>
  );
}

export default async function PersonPage({ params }: { params: Promise<{ personId: string }> }) {
  const { personId } = await params;
  const game = await getCurrentGame();
  if (!game) return null;
  const { truth, session, userId } = game;
  const person = getPerson(truth, personId);
  if (!person) notFound();

  const portraitUrls = await getReadyPortraitUrls(userId, truth);
  const home = getLocation(truth, person.homeLocationId);
  const work = person.workLocationId ? getLocation(truth, person.workLocationId) : null;
  const alibi = getAlibi(truth, personId);
  const assessment = getAlibiAssessment(truth, session, personId);
  const evidence = getVisibleEvidenceForPerson(truth, session, personId);
  const role = person.isVictim ? "Victime" : person.isSuspect ? "Suspect" : "Témoin";

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <div className="panel panel-bracketed flex flex-wrap items-start justify-between gap-4 p-5">
        <div className="flex items-center gap-4">
          <CharacterPortrait
            seed={person.avatarSeed}
            name={`${person.firstName} ${person.lastName}`}
            size={72}
            generatedSrc={portraitUrls.get(person.id)}
          />
          <div>
            <p className="field-label">{role}</p>
            <h1 className="text-2xl font-bold uppercase tracking-wide text-foreground">
              {person.firstName} {person.lastName}
            </h1>
            <p className="mt-1 font-data text-sm text-muted">
              {person.age} ans — {person.profession} — {person.sex === "male" ? "Homme" : "Femme"}
            </p>
          </div>
        </div>
        {!person.isVictim && (
          <Link href={`/investigation/interrogatoires/${person.id}`} className="btn btn-primary">
            Interroger
          </Link>
        )}
      </div>

      <section className="panel grid gap-4 p-5 md:grid-cols-3">
        <div>
          <p className="field-label">Domicile</p>
          <p className="mt-1 text-sm text-foreground">{home?.name}</p>
          <p className="text-xs text-muted">{home?.address}</p>
        </div>
        <div>
          <p className="field-label">Lieu de travail</p>
          <p className="mt-1 text-sm text-foreground">{work?.name ?? "—"}</p>
        </div>
        <div>
          <p className="field-label">Téléphone</p>
          <p className="font-data mt-1 text-sm text-foreground">{person.phoneNumber}</p>
        </div>
        {person.hasVehicle && (
          <div>
            <p className="field-label">Véhicule</p>
            <p className="font-data mt-1 text-sm text-foreground">{person.vehiclePlate}</p>
            <p className="text-xs text-muted">{person.vehicleDescription}</p>
          </div>
        )}
      </section>

      {alibi && (
        <section className="panel p-5">
          <p className="field-label">Déclaration / alibi</p>
          <p className="font-document mt-2 text-sm text-foreground">« {alibi.claim} »</p>
          <p className="font-data mt-1 text-xs text-muted">
            Fenêtre concernée : {formatGameTime(alibi.windowStart)} – {formatGameTime(alibi.windowEnd)}
          </p>
          {assessment && (assessment.corroborating.length > 0 || assessment.contradicting.length > 0) && (
            <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
              {assessment.corroborating.length > 0 && (
                <p className="border border-success/30 bg-success/5 p-2 text-success">
                  ✓ {assessment.corroborating.length} élément(s) découvert(s) corroborent cette déclaration.
                </p>
              )}
              {assessment.contradicting.length > 0 && (
                <p className="border border-danger/30 bg-danger-bg p-2 text-danger">
                  ⚠ {assessment.contradicting.length} élément(s) découvert(s) contredisent cette déclaration.
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {!person.isVictim && (
        <section className="panel p-5">
          <p className="field-label">Consulter dans les applications</p>
          <p className="mt-1 text-xs text-muted">Chaque outil a ses propres accès — certains nécessitent un mandat.</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
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
        <p className="field-label mb-3">Preuves liées ({evidence.length})</p>
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
