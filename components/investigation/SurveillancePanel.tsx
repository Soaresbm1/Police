"use client";

import { useTransition } from "react";
import { startSurveillanceAction } from "@/lib/game-session/actions";
import type { SurveillanceOverview, SurveillanceRecordView, SurveillanceTimelineEntryView } from "@/lib/game-session/player-view";

const OBSERVATION_TYPE_LABEL: Record<NonNullable<SurveillanceTimelineEntryView["observationType"]>, string> = {
  arrived: "Arrivée observée",
  departed: "Départ observé",
  present: "Présence observée",
};

function TimelineEntry({ entry }: { entry: SurveillanceTimelineEntryView }) {
  if (entry.kind === "gap") {
    return (
      <p className="text-xs italic text-muted">
        <span className="font-data not-italic text-[10px] text-muted-dim">
          {entry.fromLabel} – {entry.toLabel}
        </span>{" "}
        Aucune observation disponible.
      </p>
    );
  }
  return (
    <p className="text-xs text-foreground">
      <span className="font-data text-[10px] text-muted">
        {entry.fromLabel} – {entry.toLabel}
      </span>{" "}
      Observé(e) à {entry.locationName}
      <span className="ml-1 text-[10px] uppercase tracking-wide text-muted-dim">
        ({OBSERVATION_TYPE_LABEL[entry.observationType!]})
      </span>
      {entry.observedWithNames.length > 0 && (
        <span className="block text-[11px] text-muted">Observé(e) avec {entry.observedWithNames.join(", ")}</span>
      )}
    </p>
  );
}

function RecordCard({ record }: { record: SurveillanceRecordView }) {
  return (
    <div className="panel-sunken p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-data text-[11px] uppercase tracking-wide text-foreground">
          {record.startedAtLabel} → {record.endedAtLabel}
        </p>
        <span className="font-data text-[10px] uppercase tracking-wide text-muted">
          {record.status === "pending" ? "En cours…" : record.status === "ready" ? "Rapport disponible" : "Consulté"}
        </span>
      </div>
      {record.status === "pending" ? (
        <p className="mt-2 text-xs text-muted">Les agents sont sur le terrain — rapport à venir.</p>
      ) : record.timeline.length === 0 ? (
        <p className="mt-2 text-xs text-muted">Aucune observation disponible sur cette période.</p>
      ) : (
        <div className="mt-2 flex flex-col gap-1.5">
          {record.timeline.map((entry, i) => (
            <TimelineEntry key={i} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}

/** The person-page "Surveiller" panel (Phase 5B-1): duration options plus
 * this person's request history. `overview` is entirely server-computed
 * (`player-view.ts#getSurveillanceOverview`) — this component only renders
 * it and fires the request action, it never derives anything from truth
 * itself. Mobile-safe: a simple stacked panel, no canvas/modal. */
export function SurveillancePanel({ personId, overview }: { personId: string; overview: SurveillanceOverview }) {
  const [isPending, startTransition] = useTransition();

  return (
    <section className="panel p-5">
      <p className="field-label">Surveillance</p>
      <p className="mt-1 text-xs text-muted">Heure actuelle de l&apos;enquête : {overview.currentTimeLabel}</p>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {overview.options.map((option) => (
          <button
            key={option.durationMinutes}
            type="button"
            disabled={isPending || !option.available}
            title={option.unavailableReason ?? undefined}
            onClick={() => startTransition(() => startSurveillanceAction(personId, option.durationMinutes))}
            className="border border-border-strong px-3 py-2 text-left transition-colors hover:border-accent hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="font-data block text-[11px] uppercase tracking-wide text-foreground">{option.label}</span>
            <span className="mt-1 block text-[10px] text-muted">
              {option.available ? `Fin prévue : ${option.expectedCompletionLabel}` : option.unavailableReason}
            </span>
          </button>
        ))}
      </div>

      {overview.history.length > 0 && (
        <div className="mt-4 flex flex-col gap-3">
          <p className="field-label">Rapports de surveillance</p>
          {overview.history.map((record) => (
            <RecordCard key={record.key} record={record} />
          ))}
        </div>
      )}
    </section>
  );
}
