import { notFound } from "next/navigation";
import { getCurrentGame } from "@/lib/game-session/current";
import { getPerson } from "@/lib/game-session/player-view";
import { getInterrogationTopics } from "@/lib/game-session/interrogation-view";
import { InterrogationTopicButton } from "@/components/investigation/InterrogationTopicButton";

export default async function InterrogationPage({ params }: { params: Promise<{ personId: string }> }) {
  const { personId } = await params;
  const game = await getCurrentGame();
  if (!game) return null;
  const person = getPerson(game.truth, personId);
  if (!person) notFound();

  const topics = getInterrogationTopics(game.truth, game.session, personId);
  const asked = topics.filter((t) => t.asked);
  const unasked = topics.filter((t) => !t.asked);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted">Audition</p>
        <h1 className="text-2xl font-semibold text-foreground">
          {person.firstName} {person.lastName}
        </h1>
        <p className="mt-1 text-sm text-muted">
          Posez vos questions, puis comparez ses réponses aux preuves recueillies dans les onglets Preuves et
          Chronologie — le jeu ne vous dira jamais directement si elle/il ment.
        </p>
      </div>

      <section>
        <h2 className="mb-3 text-xs uppercase tracking-wide text-muted">Compte-rendu ({asked.length})</h2>
        {asked.length === 0 ? (
          <p className="text-sm text-muted">Aucune question posée pour l&apos;instant.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {asked
              .sort((a, b) => a.time - b.time)
              .map((topic) => (
                <div key={topic.factId} className="rounded border border-border bg-surface p-4">
                  <p className="text-xs uppercase tracking-wide text-muted">{topic.topicLabel}</p>
                  <p className="mt-1 text-sm text-foreground">
                    {person.firstName} : « {topic.statement} »
                  </p>
                </div>
              ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-xs uppercase tracking-wide text-muted">Sujets à aborder ({unasked.length})</h2>
        {unasked.length === 0 ? (
          <p className="text-sm text-muted">Tous les sujets connus ont été abordés.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {unasked.map((topic) => (
              <InterrogationTopicButton key={topic.factId} personId={personId} factId={topic.factId} label={topic.topicLabel} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
