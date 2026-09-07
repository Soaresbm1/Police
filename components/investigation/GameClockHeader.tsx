import { formatGameTime } from "@/lib/game-engine/types/time";
import { advanceTimeAction, endCurrentCase } from "@/lib/game-session/actions";
import type { GameSession } from "@/lib/game-session/types";

export function GameClockHeader({ session }: { session: GameSession }) {
  const pendingLabJobs = session.labQueue.filter((job) => {
    const status = session.evidenceStatus[job.evidenceId];
    return status === "sent_to_lab";
  });

  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface px-6 py-3">
      <div className="flex items-center gap-4">
        <span className="font-data text-sm text-accent-strong">{session.seed}</span>
        <span className="text-xs uppercase tracking-wide text-muted">{session.difficulty}</span>
        <span className="font-data text-sm text-foreground">{formatGameTime(session.currentTime)}</span>
        {pendingLabJobs.length > 0 && (
          <span className="rounded bg-warning/15 px-2 py-0.5 text-xs text-warning">
            {pendingLabJobs.length} analyse(s) en cours
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <form action={advanceTimeAction.bind(null, 30)}>
          <button type="submit" className="rounded border border-border-strong px-2 py-1 text-xs text-muted hover:text-foreground">
            +30 min
          </button>
        </form>
        <form action={advanceTimeAction.bind(null, 60)}>
          <button type="submit" className="rounded border border-border-strong px-2 py-1 text-xs text-muted hover:text-foreground">
            +1 h
          </button>
        </form>
        <form action={advanceTimeAction.bind(null, 240)}>
          <button type="submit" className="rounded border border-border-strong px-2 py-1 text-xs text-muted hover:text-foreground">
            +4 h
          </button>
        </form>
        <form action={endCurrentCase}>
          <button type="submit" className="rounded px-2 py-1 text-xs text-muted hover:text-danger">
            Quitter l&apos;enquête
          </button>
        </form>
      </div>
    </header>
  );
}
