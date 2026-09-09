"use client";

import { useEffect, useState, useTransition } from "react";
import {
  executeSearchWarrantAction,
  requestSearchMandateAppAction,
  type SearchWarrantResult,
} from "@/lib/game-session/app-actions";
import type { MandateRequestOutcome } from "@/lib/game-session/mandates";
import { AppFrame } from "./AppFrame";
import { RecordTable } from "./RecordTable";
import { PersonPicker, type PersonOption } from "./PersonPicker";
import type { MandateOverviewItem } from "@/lib/game-session/player-view";
import { playSound } from "@/lib/sound/sound-manager";

const KIND_LABEL: Record<string, string> = { search: "Perquisition", bank: "Bancaire" };
const STATUS_LABEL: Record<MandateOverviewItem["status"], string> = { pending: "En attente", granted: "Accordé", denied: "Refusé" };
const STATUS_STAMP: Record<MandateOverviewItem["status"], string> = { pending: "stamp-amber", granted: "stamp-blue", denied: "stamp-red" };

export function MandatsApp({
  people,
  mandates,
  initialPersonId,
}: {
  people: PersonOption[];
  mandates: MandateOverviewItem[];
  initialPersonId?: string;
}) {
  const [selected, setSelected] = useState<PersonOption | null>(null);
  const [requestState, setRequestState] = useState<MandateRequestOutcome | null>(null);
  const [warrantResult, setWarrantResult] = useState<SearchWarrantResult | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSelect = (personId: string) => {
    setSelected(people.find((p) => p.id === personId) ?? null);
    setWarrantResult(null);
    // Re-selecting someone who already has a request on file re-checks its
    // current status (idempotent — never re-schedules or resets the
    // delay) so the player sees an up-to-date "pending"/"granted"/"denied"
    // without having to click "Déposer" again.
    const alreadyRequested = mandates.some((m) => m.kind === "search" && m.personId === personId);
    if (alreadyRequested) {
      startTransition(async () => {
        setRequestState(await requestSearchMandateAppAction(personId));
      });
    } else {
      setRequestState(null);
    }
  };

  useEffect(() => {
    // Deliberate one-shot: a deep link from a suspect's profile pre-selects
    // them here instead of making the player retype the name.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (initialPersonId) handleSelect(initialPersonId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const requestMandate = () => {
    if (!selected) return;
    startTransition(async () => {
      // Always resolves to "pending" here — the decision itself only
      // becomes knowable once its administrative delay has elapsed, so
      // there's nothing to play a granted/denied sound about yet.
      const res = await requestSearchMandateAppAction(selected.id);
      setRequestState(res);
    });
  };

  const executeSearch = () => {
    if (!selected) return;
    startTransition(async () => {
      const res = await executeSearchWarrantAction(selected.id);
      setWarrantResult(res);
      if (res.status === "ready") playSound("success");
    });
  };

  return (
    <AppFrame title="Mandats" system="MP-CANTON — Suivi des réquisitions et mandats judiciaires" accent="red">
      <div className="panel p-4">
        <p className="field-label mb-2">Historique des demandes ({mandates.length})</p>
        {mandates.length === 0 ? (
          <p className="text-sm text-muted">Aucune demande de mandat déposée pour l&apos;instant.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {mandates.map((m) => (
              <div key={m.key} className="flex items-center justify-between border border-border-strong px-3 py-2 text-sm">
                <span className="text-foreground">
                  {KIND_LABEL[m.kind]} — {m.personName}
                </span>
                <span className={`stamp !py-0.5 !text-[9px] ${STATUS_STAMP[m.status]}`}>{STATUS_LABEL[m.status]}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="panel p-4">
        <p className="field-label mb-2">Nouvelle demande de perquisition</p>
        <PersonPicker people={people} onSelect={handleSelect} />

        {selected && (
          <div className="mt-3 border border-border-strong p-3">
            <p className="text-sm text-foreground">
              Cible : <span className="font-medium">{selected.name}</span>
            </p>
            <button onClick={requestMandate} disabled={isPending} className="btn btn-danger mt-2">
              {isPending ? "Dépôt en cours…" : "Déposer la demande de mandat"}
            </button>

            {requestState && (
              <div
                className={`mt-3 border p-2 text-xs ${
                  requestState.status === "granted"
                    ? "border-success/40 text-success"
                    : requestState.status === "denied"
                      ? "border-danger/40 text-danger"
                      : "border-border-strong text-muted"
                }`}
              >
                {requestState.reason}
              </div>
            )}

            {requestState?.status === "granted" && (
              <button onClick={executeSearch} disabled={isPending} className="btn btn-primary mt-3">
                Exécuter la perquisition
              </button>
            )}
          </div>
        )}
      </div>

      {warrantResult && warrantResult.status === "ready" && (
        <div className="panel p-4">
          <p className="field-label">
            Perquisition — {warrantResult.ownerName} ({warrantResult.locationName})
          </p>
          <div className="mt-3 border-t border-border pt-3">
            <RecordTable lines={warrantResult.lines} emptyLabel="Rien de probant trouvé sur place." />
          </div>
        </div>
      )}
    </AppFrame>
  );
}
