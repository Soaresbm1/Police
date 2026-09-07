import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentGame } from "@/lib/game-session/current";
import { getStore } from "@/lib/game-session/persistence";
import { GameShell } from "@/components/shell/GameShell";

export const dynamic = "force-dynamic";

export default async function InvestigationLayout({ children }: { children: ReactNode }) {
  const game = await getCurrentGame();
  if (!game) {
    redirect("/");
  }

  const profile = await getStore().getProfile(game.userId);

  return (
    <GameShell session={game.session} settings={profile.settings}>
      {children}
    </GameShell>
  );
}
