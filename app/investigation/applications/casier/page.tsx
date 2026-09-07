import { getCurrentGame } from "@/lib/game-session/current";
import { getAllPeople } from "@/lib/game-session/player-view";
import { CasierApp } from "@/components/investigation/apps/CasierApp";

export default async function CasierPage({ searchParams }: { searchParams: Promise<{ person?: string }> }) {
  const game = await getCurrentGame();
  if (!game) return null;
  const params = await searchParams;
  const people = getAllPeople(game.truth)
    .filter((p) => !p.isVictim)
    .map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}`, detail: p.profession }));

  return <CasierApp people={people} initialPersonId={params.person} />;
}
