import { formatGameTime } from "@/lib/game-engine/types/time";
import { advanceTimeAction, endCurrentCase } from "@/lib/game-session/actions";
import type { GameSession } from "@/lib/game-session/types";
import { SoundToggle } from "@/components/investigation/SoundToggle";

const DIFFICULTY_LABEL: Record<GameSession["difficulty"], string> = {
  recruit: "Recrue",
  investigator: "Enquêteur",
  inspector: "Inspecteur",
  expert: "Expert",
};

export function TopBar({ session }: { session: GameSession }) {
  const pendingLabJobs = session.labQueue.filter((job) => session.evidenceStatus[job.evidenceId] === "sent_to_lab");
  const [dayLabel, clockLabel] = formatGameTime(session.currentTime).split(", ");

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface px-4">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center border border-accent text-[11px] font-bold text-accent-strong">
            C
          </span>
          <span className="text-sm font-semibold tracking-[0.2em] text-foreground">CASELINE</span>
        </div>
        <span className="hidden text-[10px] uppercase tracking-[0.18em] text-muted-dim sm:inline">Réseau Police</span>
        <span className="mx-1 hidden h-5 w-px bg-border sm:inline" />
        <span className="data-id hidden sm:inline">DOSSIER {session.seed}</span>
        <span className="hidden border border-border-strong px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted md:inline">
          {DIFFICULTY_LABEL[session.difficulty]}
        </span>
        {pendingLabJobs.length > 0 && (
          <span className="hidden items-center gap-1 border border-warning/40 bg-warning/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-warning lg:flex">
            <span className="h-1.5 w-1.5 animate-pulse bg-warning" />
            {pendingLabJobs.length} analyse(s) en cours
          </span>
        )}
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-baseline gap-2 font-data">
          <span className="text-[11px] uppercase tracking-wide text-muted">{dayLabel}</span>
          <span className="text-lg font-semibold text-foreground">{clockLabel}</span>
        </div>
        <div className="hidden items-center gap-1 sm:flex">
          <form action={advanceTimeAction.bind(null, 30)}>
            <button type="submit" className="btn btn-ghost !px-2 !py-1 !text-[10px]">
              +30min
            </button>
          </form>
          <form action={advanceTimeAction.bind(null, 60)}>
            <button type="submit" className="btn btn-ghost !px-2 !py-1 !text-[10px]">
              +1h
            </button>
          </form>
          <form action={advanceTimeAction.bind(null, 240)}>
            <button type="submit" className="btn btn-ghost !px-2 !py-1 !text-[10px]">
              +4h
            </button>
          </form>
        </div>
        <SoundToggle />
        <form action={endCurrentCase}>
          <button type="submit" className="btn btn-ghost !px-2 !py-1 !text-[10px] hover:!text-danger">
            Quitter
          </button>
        </form>
      </div>
    </header>
  );
}
