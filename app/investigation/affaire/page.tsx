import { getCurrentGame } from "@/lib/game-session/current";
import { getBriefing, getLocation, getPerson } from "@/lib/game-session/player-view";
import { examineCrimeSceneAction } from "@/lib/game-session/actions";
import { formatGameTime } from "@/lib/game-engine/types/time";

export default async function AffairePage() {
  const game = await getCurrentGame();
  if (!game) return null;
  const { truth, session } = game;
  const briefing = getBriefing(truth);
  const victim = getPerson(truth, truth.victimId)!;
  const crimeScene = getLocation(truth, truth.crimeLocationId);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted">Dossier — {briefing.crimeType}</p>
        <h1 className="text-2xl font-semibold text-foreground">Homicide de {briefing.victimName}</h1>
      </div>

      <section className="grid gap-4 rounded border border-border bg-surface p-5 md:grid-cols-2">
        <div>
          <h2 className="text-xs uppercase tracking-wide text-muted">Victime</h2>
          <p className="mt-1 text-foreground">
            {victim.firstName} {victim.lastName}, {victim.age} ans — {victim.profession}
          </p>
        </div>
        <div>
          <h2 className="text-xs uppercase tracking-wide text-muted">Lieu de découverte</h2>
          <p className="mt-1 text-foreground">{crimeScene?.name}</p>
          <p className="text-sm text-muted">{crimeScene?.address}</p>
        </div>
        <div>
          <h2 className="text-xs uppercase tracking-wide text-muted">Signalement</h2>
          <p className="mt-1 text-sm text-foreground">{briefing.discoveryDescription}</p>
        </div>
        <div>
          <h2 className="text-xs uppercase tracking-wide text-muted">Heure du signalement</h2>
          <p className="mt-1 font-data text-sm text-foreground">{formatGameTime(briefing.reportedAt)}</p>
        </div>
      </section>

      <section className="rounded border border-border bg-surface p-5">
        <h2 className="text-xs uppercase tracking-wide text-muted">Rapport du médecin légiste</h2>
        <dl className="mt-3 grid gap-3 text-sm md:grid-cols-2">
          <div>
            <dt className="text-muted">Décès estimé entre</dt>
            <dd className="font-data text-foreground">
              {formatGameTime(truth.autopsy.estimatedDeathWindowStart)} et {formatGameTime(truth.autopsy.estimatedDeathWindowEnd)}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Cause du décès</dt>
            <dd className="text-foreground">{truth.autopsy.causeOfDeath}</dd>
          </div>
          <div>
            <dt className="text-muted">Blessures constatées</dt>
            <dd className="text-foreground">{truth.autopsy.wounds.join(", ") || "aucune particulière"}</dd>
          </div>
          <div>
            <dt className="text-muted">Position du corps</dt>
            <dd className="text-foreground">{truth.autopsy.bodyPosition}</dd>
          </div>
          {truth.autopsy.substancesFound.length > 0 && (
            <div>
              <dt className="text-muted">Substances retrouvées</dt>
              <dd className="text-foreground">{truth.autopsy.substancesFound.join(", ")}</dd>
            </div>
          )}
          {truth.autopsy.notableFeatures.length > 0 && (
            <div>
              <dt className="text-muted">Éléments notables</dt>
              <dd className="text-foreground">{truth.autopsy.notableFeatures.join(", ")}</dd>
            </div>
          )}
        </dl>
      </section>

      <section className="rounded border border-border bg-surface p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xs uppercase tracking-wide text-muted">Scène de crime</h2>
            <p className="mt-1 text-sm text-muted">
              {session.crimeSceneExamined
                ? "La scène a été examinée — consultez l'onglet Preuves pour les éléments relevés."
                : "La scène n'a pas encore été examinée par vos équipes."}
            </p>
          </div>
          <form action={examineCrimeSceneAction}>
            <button
              type="submit"
              disabled={session.crimeSceneExamined}
              className="rounded bg-accent px-4 py-2 text-sm font-medium text-background hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-40"
            >
              {session.crimeSceneExamined ? "Scène déjà examinée" : "Examiner la scène de crime"}
            </button>
          </form>
        </div>
      </section>

      <section className="rounded border border-border bg-surface p-5 text-sm text-muted">
        <p>
          {briefing.suspectCount} suspect(s) et {briefing.witnessCount} témoin(s) sont recensés autour de cette affaire.
          Consultez les onglets <span className="text-foreground">Suspects</span> et{" "}
          <span className="text-foreground">Témoins</span> pour commencer les investigations.
        </p>
      </section>
    </div>
  );
}
