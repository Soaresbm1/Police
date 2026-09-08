import Link from "next/link";
import { getCurrentGame } from "@/lib/game-session/current";
import { getBriefing, getLocation, getPerson } from "@/lib/game-session/player-view";
import { formatGameTime } from "@/lib/game-engine/types/time";
import { formatCaseNumber } from "@/lib/game-engine/world/city";
import { Avatar } from "@/components/investigation/Avatar";
import { CaseIntroOverlay } from "@/components/investigation/CaseIntroOverlay";
import { OnboardingHint } from "@/components/investigation/OnboardingHint";
import { DocumentSheet } from "@/components/investigation/DocumentSheet";

export default async function AffairePage() {
  const game = await getCurrentGame();
  if (!game) return null;
  const { truth, session } = game;
  const briefing = getBriefing(truth);
  const victim = getPerson(truth, truth.victimId)!;
  const crimeScene = getLocation(truth, truth.crimeLocationId);
  const victimName = `${victim.firstName} ${victim.lastName}`;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <CaseIntroOverlay
        seed={session.seed}
        caseNumber={formatCaseNumber(session.seed)}
        crimeType={briefing.crimeType}
        victimName={victimName}
        victimAvatarSeed={victim.avatarSeed}
        locationName={crimeScene?.name ?? "Lieu inconnu"}
        locationAddress={crimeScene?.address ?? ""}
        reportedAtLabel={formatGameTime(briefing.reportedAt)}
      />

      <OnboardingHint
        id="dossier-scene"
        text="Commencez par explorer la scène de crime pour relever les premiers indices."
      />

      <div className="panel panel-bracketed flex flex-wrap items-start justify-between gap-4 p-5">
        <div>
          <p className="data-id">DOSSIER N° {formatCaseNumber(session.seed)}</p>
          <h1 className="mt-1 text-2xl font-bold uppercase tracking-wide text-foreground">
            Homicide — {victimName}
          </h1>
        </div>
        <div className="flex gap-2">
          <span className="stamp stamp-red">{briefing.crimeType}</span>
          <span className="stamp stamp-amber">En cours</span>
        </div>
      </div>

      <section className="panel flex flex-col gap-4 p-5 md:flex-row">
        <Avatar seed={victim.avatarSeed} name={victimName} size={88} />
        <div className="grid flex-1 gap-4 sm:grid-cols-2">
          <div>
            <p className="field-label">Victime</p>
            <p className="mt-1 text-foreground">
              {victimName}, {victim.age} ans — {victim.profession}
            </p>
          </div>
          <div>
            <p className="field-label">Lieu de découverte</p>
            <p className="mt-1 text-foreground">{crimeScene?.name}</p>
            <p className="text-sm text-muted">{crimeScene?.address}</p>
          </div>
          <div>
            <p className="field-label">Signalement</p>
            <p className="mt-1 text-sm text-foreground">{briefing.discoveryDescription}</p>
          </div>
          <div>
            <p className="field-label">Heure du signalement</p>
            <p className="mt-1 font-data text-sm text-foreground">{formatGameTime(briefing.reportedAt)}</p>
          </div>
        </div>
      </section>

      <DocumentSheet title="Rapport du médecin légiste" caseRef={formatCaseNumber(session.seed)} pageLabel="Page 1/1">
        <dl className="font-document grid gap-3 text-sm md:grid-cols-2">
          <div>
            <dt className="field-label !text-muted">Décès estimé entre</dt>
            <dd className="font-data text-foreground">
              {formatGameTime(truth.autopsy.estimatedDeathWindowStart)} et {formatGameTime(truth.autopsy.estimatedDeathWindowEnd)}
            </dd>
          </div>
          <div>
            <dt className="field-label !text-muted">Cause du décès</dt>
            <dd className="text-foreground">{truth.autopsy.causeOfDeath}</dd>
          </div>
          <div>
            <dt className="field-label !text-muted">Blessures constatées</dt>
            <dd className="text-foreground">{truth.autopsy.wounds.join(", ") || "aucune particulière"}</dd>
          </div>
          <div>
            <dt className="field-label !text-muted">Position du corps</dt>
            <dd className="text-foreground">{truth.autopsy.bodyPosition}</dd>
          </div>
          {truth.autopsy.substancesFound.length > 0 && (
            <div>
              <dt className="field-label !text-muted">Substances retrouvées</dt>
              <dd className="text-foreground">{truth.autopsy.substancesFound.join(", ")}</dd>
            </div>
          )}
          {truth.autopsy.notableFeatures.length > 0 && (
            <div>
              <dt className="field-label !text-muted">Éléments notables</dt>
              <dd className="text-foreground">{truth.autopsy.notableFeatures.join(", ")}</dd>
            </div>
          )}
        </dl>
      </DocumentSheet>

      <section className="panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="field-label">Scène de crime</p>
            <p className="mt-1 text-sm text-muted">
              {session.crimeSceneExamined
                ? "Explorez à nouveau la scène pour vérifier les zones encore inexplorées."
                : "La scène n'a pas encore été explorée par vos équipes."}
            </p>
          </div>
          <Link href="/investigation/scene" className="btn btn-primary">
            {session.crimeSceneExamined ? "Rouvrir la scène" : "Explorer la scène de crime"}
          </Link>
        </div>
      </section>

      <section className="panel p-5 text-sm text-muted">
        <p>
          {briefing.suspectCount} suspect(s) et {briefing.witnessCount} témoin(s) sont recensés autour de cette affaire.
          Consultez <span className="text-foreground">Suspects</span> et <span className="text-foreground">Témoins</span> pour
          commencer les investigations.
        </p>
      </section>
    </div>
  );
}
