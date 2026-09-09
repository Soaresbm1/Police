import Link from "next/link";
import { formatGameTime } from "@/lib/game-engine/types/time";
import { CITY, formatCaseNumber } from "@/lib/game-engine/world/city";
import { advanceTimeAction, endCurrentCase } from "@/lib/game-session/actions";
import type { GameSession } from "@/lib/game-session/types";
import type { PlayerSettings } from "@/lib/game-session/persistence";
import { getReadyUnseenEventCount } from "@/lib/game-session/player-view";
import { SoundToggle } from "@/components/investigation/SoundToggle";
import { SettingsOverlay } from "./SettingsOverlay";
import { PoliceEmblem } from "@/components/shared/PoliceEmblem";

const DIFFICULTY_LABEL: Record<GameSession["difficulty"], string> = {
  recruit: "Recrue",
  investigator: "Enquêteur",
  inspector: "Inspecteur",
  expert: "Expert",
};

export function TopBar({ session, settings }: { session: GameSession; settings: PlayerSettings }) {
  const pendingLabJobs = session.labQueue.filter((job) => session.evidenceStatus[job.evidenceId] === "sent_to_lab");
  const readyUnseenEvents = getReadyUnseenEventCount(session);
  const [dayLabel, clockLabel] = formatGameTime(session.currentTime).split(", ");

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border bg-surface px-2 pt-[var(--safe-top)] sm:px-4">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex items-center gap-2">
          <PoliceEmblem size={22} className="text-accent-strong" />
          {/* These extra identity/case-number reveals used to key off
             `sm`/`md` (640/768px) — fine when that was already desktop
             territory, but the mobile shell (bottom nav, no sidebar) now
             runs all the way up to `lg` (1024px, see GameShell.tsx), and
             cramming this much text into a tablet-width bar with no
             sidebar to absorb the width caused real overlap at ~768px.
             Gated on `lg` now, matching the actual shell breakpoint. */}
          <span className="hidden text-sm font-semibold tracking-[0.2em] text-foreground lg:inline">CASELINE</span>
        </div>
        <span className="hidden text-[10px] uppercase tracking-[0.18em] text-muted-dim lg:inline">{CITY.policeShortName}</span>
        <span className="mx-1 hidden h-5 w-px bg-border lg:inline" />
        <span className="data-id hidden lg:inline">DOSSIER {formatCaseNumber(session.seed)}</span>
        <span className="hidden border border-border-strong px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted lg:inline">
          {DIFFICULTY_LABEL[session.difficulty]}
        </span>
        {pendingLabJobs.length > 0 && (
          <span className="hidden items-center gap-1 border border-warning/40 bg-warning/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-warning lg:flex">
            <span className="h-1.5 w-1.5 animate-pulse bg-warning" />
            {pendingLabJobs.length} analyse(s) en cours
          </span>
        )}
        {readyUnseenEvents > 0 && (
          <Link
            href="/investigation/activite"
            className="hidden items-center gap-1 border border-accent-dim bg-accent-dim/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-accent-strong transition-colors hover:bg-accent-dim/20 lg:flex"
          >
            <span className="h-1.5 w-1.5 animate-pulse bg-accent-strong" />
            {readyUnseenEvents} nouvelle(s) entrée(s)
          </Link>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-4">
        <div className="flex items-baseline gap-1.5 font-data sm:gap-2">
          <span className="hidden text-[11px] uppercase tracking-wide text-muted sm:inline">{dayLabel}</span>
          <span className="text-sm font-semibold text-foreground sm:text-lg">{clockLabel}</span>
        </div>
        {/* Time-advance controls: previously `hidden sm:flex`, which left
           phones with no way to advance the game clock at all — the
           single most important control in the top bar. Always visible
           now, just shrunk further below `sm`. */}
        <div className="flex items-center gap-0.5 sm:gap-1">
          <form action={advanceTimeAction.bind(null, 30)}>
            <button type="submit" className="btn btn-ghost !px-1.5 !py-1 !text-[9px] sm:!px-2 sm:!text-[10px]" title="Avancer de 30 minutes">
              +30
            </button>
          </form>
          <form action={advanceTimeAction.bind(null, 60)}>
            <button type="submit" className="btn btn-ghost !px-1.5 !py-1 !text-[9px] sm:!px-2 sm:!text-[10px]" title="Avancer d'une heure">
              +1h
            </button>
          </form>
          <form action={advanceTimeAction.bind(null, 240)}>
            <button type="submit" className="btn btn-ghost !px-1.5 !py-1 !text-[9px] sm:!px-2 sm:!text-[10px]" title="Avancer de 4 heures">
              +4h
            </button>
          </form>
        </div>
        <SoundToggle />
        <SettingsOverlay
          inGame
          difficultyLabel={DIFFICULTY_LABEL[session.difficulty]}
          initialReduceMotion={settings.reduceMotion}
          initialHintsDisabled={settings.hintsDisabled}
        />
        <form action={endCurrentCase} className="hidden sm:block">
          <button type="submit" className="btn btn-ghost !px-2 !py-1 !text-[10px] hover:!text-danger">
            Quitter
          </button>
        </form>
      </div>
    </header>
  );
}
