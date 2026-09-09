"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { markEventSeenAction } from "@/lib/game-session/actions";
import type { InvestigationEventView } from "@/lib/game-session/player-view";

/** One inbox row — marks the event `seen` and navigates to its
 * destination application in one click. A plain `<Link>` can't also fire
 * the server action first, so this stays a small client component,
 * mirroring the `useTransition` pattern already used by `BanqueApp`/
 * `MandatsApp`. */
export function EventInboxRow({ event }: { event: InvestigationEventView }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const open = () => {
    startTransition(async () => {
      await markEventSeenAction(event.id);
      if (event.href) router.push(event.href);
    });
  };

  return (
    <button
      type="button"
      onClick={open}
      disabled={isPending}
      className="panel-sunken flex w-full items-center justify-between gap-3 p-3 text-left transition-colors hover:border-accent-dim disabled:opacity-60"
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${event.status === "ready" ? "bg-accent-strong" : "bg-muted-dim"}`} />
        <div className="min-w-0">
          <p className="font-data text-[11px] uppercase tracking-wide text-foreground">{event.title}</p>
          <p className="truncate text-xs text-muted">{event.detail}</p>
        </div>
      </div>
      <span className="font-data shrink-0 text-[10px] uppercase tracking-wide text-muted">{event.scheduledAtLabel}</span>
    </button>
  );
}
