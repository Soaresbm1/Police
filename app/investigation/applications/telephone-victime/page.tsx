import { getCurrentGame } from "@/lib/game-session/current";
import { getVictimPhoneView } from "@/lib/game-session/victim-phone-view";
import { labResultEventId } from "@/lib/game-session/lab-report";
import { PhoneApp } from "@/components/investigation/apps/PhoneApp";
import { PhoneExtractionViewTracker } from "@/components/investigation/PhoneExtractionViewTracker";

export default async function TelephoneVictimePage() {
  const game = await getCurrentGame();
  if (!game) return null;
  const view = getVictimPhoneView(game.truth, game.session);
  const eventId = view.evidenceId ? (labResultEventId(game.session, view.evidenceId) ?? null) : null;
  const event = game.session.events.find((e) => e.id === eventId);
  return (
    <>
      <PhoneExtractionViewTracker eventId={eventId} status={(event?.status as "ready" | "seen" | undefined) ?? null} />
      <PhoneApp view={view} />
    </>
  );
}
