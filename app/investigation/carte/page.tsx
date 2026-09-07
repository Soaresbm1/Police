import { getCurrentGame } from "@/lib/game-session/current";
import { getMapLocations } from "@/lib/game-session/player-view";
import { InvestigationMap } from "@/components/investigation/InvestigationMap";

export default async function CartePage() {
  const game = await getCurrentGame();
  if (!game) return null;
  const locations = getMapLocations(game.truth, game.session);
  return <InvestigationMap locations={locations} />;
}
