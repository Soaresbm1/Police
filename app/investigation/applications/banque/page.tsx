import { getCurrentGame } from "@/lib/game-session/current";
import { getAllPeople } from "@/lib/game-session/player-view";
import { BanqueApp } from "@/components/investigation/apps/BanqueApp";

export default async function BanquePage({ searchParams }: { searchParams: Promise<{ person?: string }> }) {
  const game = await getCurrentGame();
  if (!game) return null;
  const params = await searchParams;
  const people = getAllPeople(game.truth)
    .filter((p) => !p.isVictim)
    .map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}`, detail: p.profession }));

  return <BanqueApp people={people} initialPersonId={params.person} />;
}
