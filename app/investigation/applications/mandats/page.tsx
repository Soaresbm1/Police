import { getCurrentGame } from "@/lib/game-session/current";
import { getAllPeople, getMandateOverview } from "@/lib/game-session/player-view";
import { MandatsApp } from "@/components/investigation/apps/MandatsApp";

export default async function MandatsPage({ searchParams }: { searchParams: Promise<{ person?: string }> }) {
  const game = await getCurrentGame();
  if (!game) return null;
  const params = await searchParams;
  const people = getAllPeople(game.truth)
    .filter((p) => !p.isVictim)
    .map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}`, detail: p.profession }));
  const mandates = getMandateOverview(game.truth, game.session);

  return <MandatsApp people={people} mandates={mandates} initialPersonId={params.person} />;
}
