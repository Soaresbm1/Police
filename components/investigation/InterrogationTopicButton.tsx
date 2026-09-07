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
      className="rounded border border-border-strong px-3 py-1.5 text-left text-sm text-foreground hover:border-accent disabled:opacity-50"
    >
      Demander à propos de {label}
    </button>
  );
}
