import type { ReactNode } from "react";
import { TopBar } from "./TopBar";
import { AppRail } from "./AppRail";
import { ActionMessage } from "@/components/investigation/ActionMessage";
import { AmbiencePlayer } from "@/components/investigation/AmbiencePlayer";
import { EventNotificationSound } from "@/components/investigation/EventNotificationSound";
import { ScreenTransition } from "./ScreenTransition";
import type { GameSession } from "@/lib/game-session/types";
import type { PlayerSettings } from "@/lib/game-session/persistence";
import { getReadyUnseenEventCount } from "@/lib/game-session/player-view";

export function GameShell({
  session,
  settings,
  children,
}: {
  session: GameSession;
  settings: PlayerSettings;
  children: ReactNode;
}) {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background-deep">
      <AmbiencePlayer />
      <EventNotificationSound readyUnseenCount={getReadyUnseenEventCount(session)} />
      <TopBar session={session} settings={settings} />
      <ActionMessage message={session.lastActionMessage} />
      <div className="flex flex-1 overflow-hidden">
        <aside className="w-52 shrink-0 border-r border-border">
          <AppRail />
        </aside>
        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          <div className="mx-auto w-full max-w-6xl px-6 py-6">
            <ScreenTransition>{children}</ScreenTransition>
          </div>
        </main>
      </div>
      <footer className="flex h-6 shrink-0 items-center justify-between border-t border-border bg-surface px-4 text-[10px] uppercase tracking-[0.16em] text-muted-dim">
        <span>Réseau sécurisé • Session active</span>
        <span>Caseline v0.10</span>
      </footer>
    </div>
  );
}
