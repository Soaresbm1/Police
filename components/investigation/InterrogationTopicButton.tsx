"use client";

import { useTransition } from "react";
import { askQuestionAction } from "@/lib/game-session/actions";

export function InterrogationTopicButton({ personId, factId, label }: { personId: string; factId: string; label: string }) {
  const [isPending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => startTransition(() => askQuestionAction(personId, factId))}
      className="border border-border-strong px-3 py-2 text-left text-sm text-foreground transition-colors hover:border-accent hover:bg-surface-raised disabled:opacity-50"
    >
      <span className="text-muted">▸</span> {label}
    </button>
  );
}
