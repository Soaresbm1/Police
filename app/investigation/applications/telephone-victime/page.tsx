import { getCurrentGame } from "@/lib/game-session/current";
import { getVictimPhoneView } from "@/lib/game-session/victim-phone-view";
import { PhoneApp } from "@/components/investigation/apps/PhoneApp";

export default async function TelephoneVictimePage() {
  const game = await getCurrentGame();
  if (!game) return null;
  const view = getVictimPhoneView(game.truth, game.session);
  return <PhoneApp view={view} />;
}
