import { getCurrentGame } from "@/lib/game-session/current";
import { getBoardPalette } from "@/lib/game-session/player-view";
import { EvidenceBoard } from "@/components/investigation/EvidenceBoard";
import { OnboardingHint } from "@/components/investigation/OnboardingHint";

export default async function TableauPage() {
  const game = await getCurrentGame();
  if (!game) return null;
  const palette = getBoardPalette(game.truth, game.session);

  return (
    <div className="flex h-full flex-col gap-3">
      <div>
        <h1 className="text-2xl font-bold uppercase tracking-wide text-foreground">Tableau d&apos;enquête</h1>
        <p className="mt-1 text-sm text-muted">Comment les éléments sont-ils connectés ? Ce sont vos propres hypothèses.</p>
      </div>
      <OnboardingHint
        id="tableau-connect"
        text="Glissez deux éléments sur le tableau pour construire une hypothèse — tirez depuis le bord d'un élément vers un autre pour les relier."
      />
      <EvidenceBoard initialNodes={game.session.board.nodes} initialEdges={game.session.board.edges} palette={palette} />
    </div>
  );
}
