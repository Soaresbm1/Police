import type { ReactNode } from "react";
import { TopBar } from "./TopBar";
import { AppRail } from "./AppRail";
import { MobileNav } from "./MobileNav";
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
  const readyUnseenEvents = getReadyUnseenEventCount(session);
  return (
    <div className="h-dvh-screen flex flex-col overflow-hidden bg-background-deep">
      <AmbiencePlayer />
      <EventNotificationSound readyUnseenCount={readyUnseenEvents} />
      <TopBar session={session} settings={settings} />
      <ActionMessage message={session.lastActionMessage} />
      <div className="flex flex-1 overflow-hidden">
        <aside className="hidden w-52 shrink-0 border-r border-border lg:block">
          <AppRail />
        </aside>
        <main className="pb-mobile-nav-safe flex-1 overflow-y-auto overflow-x-hidden">
          <div className="mx-auto w-full max-w-6xl px-3 py-4 sm:px-6 sm:py-6">
            <ScreenTransition>{children}</ScreenTransition>
          </div>
        </main>
      </div>
      <MobileNav readyUnseenEvents={readyUnseenEvents} />
      <footer className="hidden h-6 shrink-0 items-center justify-between border-t border-border bg-surface px-4 text-[10px] uppercase tracking-[0.16em] text-muted-dim lg:flex">
        <span>Réseau sécurisé • Session active</span>
        <span>Caseline v0.10</span>
      </footer>
    </div>
  );
}
