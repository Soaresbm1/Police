import { getCurrentGame } from "@/lib/game-session/current";
import { getInvestigationEventsView } from "@/lib/game-session/player-view";
import { EventInboxRow } from "@/components/investigation/EventInboxRow";

export default async function ActivitePage() {
  const game = await getCurrentGame();
  if (!game) return null;
  const events = getInvestigationEventsView(game.truth, game.session);
  const unseen = events.filter((e) => e.status === "ready").length;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div>
        <p className="field-label">Journal interne</p>
        <h1 className="text-2xl font-bold uppercase tracking-wide text-foreground">Activité</h1>
        <p className="mt-1 text-sm text-muted">
          Résultats et décisions reçus au fil de l&apos;enquête — laboratoire, banque, mandats.
        </p>
      </div>

      <section className="panel p-5">
        <p className="field-label mb-3">
          Entrées ({events.length}){unseen > 0 && <span className="ml-2 text-accent-strong">{unseen} non lue(s)</span>}
        </p>
        {events.length === 0 ? (
          <p className="text-sm text-muted">Rien à signaler pour l&apos;instant.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {events.map((event) => (
              <EventInboxRow key={event.id} event={event} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
