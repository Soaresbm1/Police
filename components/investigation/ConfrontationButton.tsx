"use client";

import { useTransition } from "react";
import { confrontAction } from "@/lib/game-session/actions";

/** `actionLabel` is server-computed per `ConfrontationRelationKind`
 * ("Confronter" for a proven alibi contradiction, "Relancer" for a
 * same-event follow-up that is NOT a proven contradiction) — this
 * component never guesses the wording itself. */
export function ConfrontationButton({
  personId,
  opportunityId,
  evidenceLabel,
  actionLabel,
}: {
  personId: string;
  opportunityId: string;
  evidenceLabel: string;
  actionLabel: string;
}) {
  const [isPending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => startTransition(() => confrontAction(personId, opportunityId))}
      className="border border-l-4 border-l-danger border-border-strong px-3 py-2 text-left text-sm text-foreground transition-colors hover:border-accent hover:bg-surface-raised disabled:opacity-50"
    >
      <span className="font-data text-[10px] uppercase tracking-wide text-danger">{actionLabel}</span>
      <span className="ml-2 text-muted">→ {evidenceLabel}</span>
    </button>
  );
}
