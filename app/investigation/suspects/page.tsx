import { getCurrentGame } from "@/lib/game-session/current";
import { getSuspects, getVisibleEvidenceForPerson } from "@/lib/game-session/player-view";
import { PersonListCard } from "@/components/investigation/PersonListCard";
import { getReadyPortraitUrls } from "@/lib/art/generation/portrait-lookup";

export default async function SuspectsPage() {
  const game = await getCurrentGame();
  if (!game) return null;
  const suspects = getSuspects(game.truth);
  const portraitUrls = await getReadyPortraitUrls(game.userId, game.truth);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold uppercase tracking-wide text-foreground">Suspects</h1>
        <p className="mt-1 text-sm text-muted">Qui pourrait avoir commis le crime ?</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {suspects.map((person) => (
          <PersonListCard
            key={person.id}
            person={person}
            evidenceCount={getVisibleEvidenceForPerson(game.truth, game.session, person.id).length}
            generatedPortraitUrl={portraitUrls.get(person.id)}
          />
        ))}
      </div>
    </div>
  );
}
