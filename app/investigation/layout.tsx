import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentGame } from "@/lib/game-session/current";
import { GameShell } from "@/components/shell/GameShell";

export const dynamic = "force-dynamic";

export default async function InvestigationLayout({ children }: { children: ReactNode }) {
  const game = await getCurrentGame();
  if (!game) {
    redirect("/");
  }

  return <GameShell session={game.session}>{children}</GameShell>;
}
