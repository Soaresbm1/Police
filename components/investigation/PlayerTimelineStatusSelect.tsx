"use client";

import { useTransition } from "react";
import { updatePlayerTimelineStatusAction } from "@/lib/game-session/actions";
import type { PlayerTimelineStatus } from "@/lib/game-session/types";

const STATUS_LABEL: Record<PlayerTimelineStatus, string> = {
  confirmed: "Confirmé",
  probable: "Probable",
  hypothesis: "Hypothèse",
  contested: "Contesté",
};

const STATUS_STYLE: Record<PlayerTimelineStatus, string> = {
  confirmed: "border-success/50 text-success",
  probable: "border-link/50 text-link",
  hypothesis: "border-warning/50 text-warning",
  contested: "border-danger/50 text-danger",
};

export function PlayerTimelineStatusSelect({ entryId, status }: { entryId: string; status: PlayerTimelineStatus }) {
  const [isPending, startTransition] = useTransition();

  return (
    <select
      defaultValue={status}
      disabled={isPending}
      className={`rounded border bg-surface px-2 py-1 text-xs ${STATUS_STYLE[status]}`}
      onChange={(e) => {
        const next = e.target.value as PlayerTimelineStatus;
        startTransition(() => {
          updatePlayerTimelineStatusAction(entryId, next);
        });
      }}
    >
      {Object.entries(STATUS_LABEL).map(([value, label]) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </select>
  );
}
