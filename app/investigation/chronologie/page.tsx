import { getCurrentGame } from "@/lib/game-session/current";
import { getKnownTimelineFacts } from "@/lib/game-session/player-view";
import { formatGameTime } from "@/lib/game-engine/types/time";
import { addPlayerTimelineEntryAction, deletePlayerTimelineEntryAction } from "@/lib/game-session/actions";
import { PlayerTimelineStatusSelect } from "@/components/investigation/PlayerTimelineStatusSelect";
import type { PlayerTimelineStatus } from "@/lib/game-session/types";

const STATUS_LABEL: Record<PlayerTimelineStatus, string> = {
  confirmed: "Confirmé",
  probable: "Probable",
  hypothesis: "Hypothèse",
  contested: "Contesté",
};

export default async function ChronologiePage() {
  const game = await getCurrentGame();
  if (!game) return null;
  const knownFacts = getKnownTimelineFacts(game.truth, game.session);
  const playerEntries = [...game.session.playerTimeline].sort((a, b) => (a.time ?? 0) - (b.time ?? 0));

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold uppercase tracking-wide text-foreground">Chronologie</h1>
        <p className="mt-1 text-sm text-muted">Qui était où, et quand ? Reconstituez la soirée à partir des preuves.</p>
      </div>

      <section>
        <h2 className="field-label mb-3">Faits établis par les preuves ({knownFacts.length})</h2>
        {knownFacts.length === 0 ? (
          <p className="text-sm text-muted">Aucun fait daté pour l&apos;instant — découvrez des preuves pour peupler la chronologie.</p>
        ) : (
          <ol className="flex flex-col gap-2 border-l border-border pl-4">
            {knownFacts.map((fact) => (
              <li key={fact.id} className="relative">
                <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-accent" />
                <span className="font-data text-xs text-accent-strong">{fact.timeLabel}</span>
                <p className="text-sm text-foreground">{fact.description}</p>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section>
        <h2 className="field-label mb-3">Votre chronologie ({playerEntries.length})</h2>
        <div className="flex flex-col gap-2">
          {playerEntries.map((entry) => (
            <div key={entry.id} className="panel flex flex-wrap items-center justify-between gap-2 p-3">
              <div>
                {entry.time !== null && <span className="font-data mr-2 text-xs text-muted">{formatGameTime(entry.time)}</span>}
                <span className="text-sm text-foreground">{entry.description}</span>
              </div>
              <div className="flex items-center gap-2">
                <PlayerTimelineStatusSelect entryId={entry.id} status={entry.status} />
                <form action={deletePlayerTimelineEntryAction.bind(null, entry.id)}>
                  <button type="submit" className="min-h-11 px-2 text-xs text-muted hover:text-danger">
                    Supprimer
                  </button>
                </form>
              </div>
            </div>
          ))}
        </div>

        <form action={addPlayerTimelineEntryAction} className="panel mt-4 flex flex-col gap-2 p-4">
          <p className="field-label">Ajouter une hypothèse</p>
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              name="description"
              required
              placeholder="Ex : Marc serait arrivé chez la victime vers 21h30"
              className="min-w-[240px] flex-1 border border-border-strong bg-surface-sunken px-3 py-2 text-base text-foreground sm:text-sm"
            />
            <select name="status" defaultValue="hypothesis" className="border border-border-strong bg-surface-sunken px-2 py-2 text-sm">
              {Object.entries(STATUS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <button type="submit" className="btn btn-primary">
              Ajouter
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
