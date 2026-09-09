import { notFound } from "next/navigation";
import { getCurrentGame } from "@/lib/game-session/current";
import { getPerson } from "@/lib/game-session/player-view";
import { getInterrogationTopics } from "@/lib/game-session/interrogation-view";
import { InterrogationTopicButton } from "@/components/investigation/InterrogationTopicButton";
import { formatGameTime } from "@/lib/game-engine/types/time";
import { CharacterPortrait } from "@/components/investigation/CharacterPortrait";
import { InterrogationAmbienceDuck } from "@/components/investigation/InterrogationAmbienceDuck";
import { ArtRefreshWatcher } from "@/components/investigation/ArtRefreshWatcher";
import { getReadyPortraitUrls, hasMissingPortraits } from "@/lib/art/generation/portrait-lookup";
import { getWitnessCallbackContent } from "@/lib/game-session/witness-callbacks";
import { WitnessCallbackViewTracker } from "@/components/investigation/WitnessCallbackViewTracker";
import { getConfrontationOptions, getPerformedConfrontations } from "@/lib/game-session/confrontations";
import { ConfrontationButton } from "@/components/investigation/ConfrontationButton";

const CALLBACK_KIND_LABEL: Record<string, string> = {
  voluntary_disclosure: "Élément volontairement rapporté",
  clarification: "Précision apportée",
};

export default async function InterrogationPage({ params }: { params: Promise<{ personId: string }> }) {
  const { personId } = await params;
  const game = await getCurrentGame();
  if (!game) return null;
  const person = getPerson(game.truth, personId);
  if (!person) notFound();

  const portraitUrls = await getReadyPortraitUrls(game.userId, game.truth);

  const topics = getInterrogationTopics(game.truth, game.session, personId);
  const asked = topics.filter((t) => t.asked).sort((a, b) => a.time - b.time);
  const unasked = topics.filter((t) => !t.asked);
  const callback = getWitnessCallbackContent(game.truth, game.session, personId);
  const confrontOptions = getConfrontationOptions(game.truth, game.session, personId);
  const performedConfrontations = getPerformedConfrontations(game.truth, game.session, personId);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <ArtRefreshWatcher pending={hasMissingPortraits([person.id], portraitUrls)} />
      <InterrogationAmbienceDuck />
      <div className="panel panel-bracketed flex items-center gap-4 border-l-4 border-l-danger p-5">
        <CharacterPortrait
          seed={person.avatarSeed}
          name={`${person.firstName} ${person.lastName}`}
          size={64}
          generatedSrc={portraitUrls.get(person.id)}
        />
        <div>
          <p className="font-data text-[10px] uppercase tracking-[0.25em] text-danger">Salle d&apos;audition</p>
          <h1 className="text-xl font-bold uppercase tracking-wide text-foreground">
            {person.firstName} {person.lastName}
          </h1>
          <p className="mt-1 text-xs text-muted">
            Comparez ses réponses aux preuves et à la chronologie — rien ne vous dira directement si elle/il ment.
          </p>
        </div>
      </div>

      {callback && (
        <section className="panel panel-bracketed border border-l-4 border-l-accent p-4">
          <WitnessCallbackViewTracker personId={personId} status={callback.status} />
          <p className="field-label mb-2 text-accent">TÉMOIN — {CALLBACK_KIND_LABEL[callback.kind] ?? "Nouveau témoignage"}</p>
          <p className="font-document text-sm text-foreground">
            {person.firstName} : « {callback.content} »
          </p>
        </section>
      )}

      <section className="panel-sunken border border-border p-4">
        <p className="field-label mb-3">Transcript ({asked.length})</p>
        {asked.length === 0 ? (
          <p className="font-document text-sm text-muted">Aucune question posée pour l&apos;instant.</p>
        ) : (
          <div className="flex flex-col gap-3 font-document text-sm">
            {asked.map((topic) => {
              const options = confrontOptions.filter((o) => o.factId === topic.factId);
              const performed = performedConfrontations.filter((c) => c.factId === topic.factId);
              return (
                <div key={topic.factId} className="border-b border-border/60 pb-3 last:border-0 last:pb-0">
                  <p className="font-data text-[10px] uppercase tracking-wide text-muted">
                    {formatGameTime(topic.time)} — {topic.topicLabel}
                  </p>
                  <p className="mt-1 text-foreground">
                    {person.firstName} : « {topic.statement} »
                  </p>
                  {performed.map((c) => (
                    <div key={c.opportunityId} className="mt-2 border-l-2 border-l-accent pl-2">
                      <p className="font-data text-[10px] uppercase tracking-wide text-accent">
                        {c.resultLabel} : {c.evidenceLabel}
                      </p>
                      <p className="mt-0.5 text-foreground">
                        {person.firstName} : « {c.reaction} »
                      </p>
                    </div>
                  ))}
                  {options.length > 0 && (
                    <div className="mt-2 flex flex-col gap-1.5">
                      {options.map((o) => (
                        <ConfrontationButton
                          key={o.opportunityId}
                          personId={personId}
                          opportunityId={o.opportunityId}
                          evidenceLabel={o.evidenceLabel}
                          actionLabel={o.actionLabel}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="panel p-4">
        <p className="field-label mb-3">Sujets à aborder ({unasked.length})</p>
        {unasked.length === 0 ? (
          <p className="text-sm text-muted">Tous les sujets connus ont été abordés.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {unasked.map((topic) => (
              <InterrogationTopicButton key={topic.factId} personId={personId} factId={topic.factId} label={topic.topicLabel} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
