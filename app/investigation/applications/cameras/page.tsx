import { getCurrentGame } from "@/lib/game-session/current";
import { getCameraEquippedLocations } from "@/lib/game-session/player-view";
import { CamerasApp } from "@/components/investigation/apps/CamerasApp";

export default async function CamerasPage({ searchParams }: { searchParams: Promise<{ location?: string }> }) {
  const game = await getCurrentGame();
  if (!game) return null;
  const params = await searchParams;
  const locations = getCameraEquippedLocations(game.truth);

  return <CamerasApp locations={locations} initialLocationId={params.location} />;
}
