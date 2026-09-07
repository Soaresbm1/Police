import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentGame } from "@/lib/game-session/current";
import { getPerson } from "@/lib/game-session/player-view";
import { scoreAccusation } from "@/lib/game-session/scoring";
import { MOTIVE_LABEL } from "@/lib/game-session/labels";
import { formatDuration, formatGameTime } from "@/lib/game-engine/types/time";

const GRADE_COLOR: Record<string, string> = {
  S: "text-accent-strong",
  A: "text-success",
  B: "text-link",
  C: "text-warning",
  D: "text-danger",
};

export default async function RapportPage() {
  const game = await getCurrentGame();
  if (!game) return null;
  const { truth, session } = game;
  if (!session.accusation) redirect("/investigation/accusation");

  const score = scoreAccusation(truth, session, session.accusation);
  const accusedPerson = getPerson(truth, session.accusation.culpritId);
  const realCulprit = getPerson(truth, truth.culpritId);
  const realVictim = getPerson(truth, truth.victimId);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <div className="text-center">
        <p className="text-xs uppercase tracking-wide text-muted">Rapport final</p>
        <p className={`mt-2 font-data text-6xl font-bold ${GRADE_COLOR[score.grade]}`}>{score.grade}</p>
        <p className="mt-1 text-sm text-muted">{score.overallPercent}% — {score.culpritCorrect ? "Affaire résolue" : "Erreur judiciaire"}</p>
      </div>

      <section className="grid gap-4 rounded border border-border bg-surface p-6 sm:grid-cols-2">
        <Stat label="Coupable désigné" value={`${accusedPerson?.firstName} ${accusedPerson?.lastName}`} good={score.culpritCorrect} />
        <Stat label="Mobile" value={score.motiveCorrect ? "Correct" : "Incorrect"} good={score.motiveCorrect} />
        <Stat label="Méthode" value={score.methodCorrect ? "Correcte" : "Incorrecte"} good={score.methodCorrect} />
        <Stat
          label="Preuves importantes trouvées"
          value={`${score.importantEvidenceFound} / ${score.importantEvidenceTotal}`}
          good={score.importantEvidenceFound === score.importantEvidenceTotal}
        />
        <Stat label="Couverture de la chronologie" value={`${score.chronologyCoveragePercent}%`} good={score.chronologyCoveragePercent >= 60} />
        <Stat label="Interrogatoires menés" value={String(score.interrogationsCount)} />
        <Stat label="Mandats accordés / demandés" value={`${score.mandatesGranted} / ${score.mandatesRequested}`} />
        <Stat label="Mandats sans lien avec le coupable" value={String(score.mandatesWasted)} good={score.mandatesWasted === 0} />
        <Stat label="Temps d'enquête" value={formatDuration(score.gameTimeSpentMinutes)} />
      </section>

      <section className="rounded border border-border bg-surface p-6">
        <h2 className="mb-3 text-sm uppercase tracking-wide text-accent-strong">Ce qui s&apos;est réellement passé</h2>
        <div className="mb-4 grid gap-2 text-sm sm:grid-cols-2">
          <p>
            <span className="text-muted">Victime : </span>
            <span className="text-foreground">
              {realVictim?.firstName} {realVictim?.lastName}
            </span>
          </p>
          <p>
            <span className="text-muted">Coupable : </span>
            <span className="text-foreground">
              {realCulprit?.firstName} {realCulprit?.lastName}
            </span>
          </p>
          <p className="sm:col-span-2">
            <span className="text-muted">Mobile : </span>
            <span className="text-foreground">
              {MOTIVE_LABEL[truth.motive.type]} — {truth.motive.description}
            </span>
          </p>
          <p className="sm:col-span-2">
            <span className="text-muted">Méthode : </span>
            <span className="text-foreground">{truth.method}</span>
          </p>
        </div>

        <ol className="flex flex-col gap-2 border-l border-border pl-4">
          {[...truth.timeline]
            .sort((a, b) => a.timestamp - b.timestamp)
            .map((event) => (
              <li key={event.id} className={`relative ${event.isCrimeEvent ? "text-danger" : ""}`}>
                <span className={`absolute -left-[21px] top-1.5 h-2 w-2 rounded-full ${event.isCrimeEvent ? "bg-danger" : "bg-border-strong"}`} />
                <span className="font-data text-xs text-muted">{formatGameTime(event.timestamp)}</span>
                <p className="text-sm">{event.description}</p>
              </li>
            ))}
        </ol>
      </section>

      <div className="text-center">
        <Link href="/" className="rounded bg-accent px-5 py-2 text-sm font-medium text-background hover:bg-accent-strong">
          Retour au commissariat
        </Link>
      </div>
    </div>
  );
}

function Stat({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-1 text-sm font-medium ${good === true ? "text-success" : good === false ? "text-danger" : "text-foreground"}`}>{value}</p>
    </div>
  );
}
