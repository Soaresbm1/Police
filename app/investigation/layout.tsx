import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentGame } from "@/lib/game-session/current";
import { Nav } from "@/components/investigation/Nav";
import { GameClockHeader } from "@/components/investigation/GameClockHeader";
import { ActionMessage } from "@/components/investigation/ActionMessage";

export const dynamic = "force-dynamic";

export default async function InvestigationLayout({ children }: { children: ReactNode }) {
  const game = await getCurrentGame();
  if (!game) {
    redirect("/");
  }

  return (
    <div className="flex min-h-screen flex-col">
      <GameClockHeader session={game.session} />
      <ActionMessage message={game.session.lastActionMessage} />
      <div className="flex flex-1">
        <aside className="w-56 shrink-0 border-r border-border bg-surface p-4">
          <Nav />
        </aside>
        <main className="flex-1 overflow-x-auto p-6">{children}</main>
      </div>
    </div>
  );
}
