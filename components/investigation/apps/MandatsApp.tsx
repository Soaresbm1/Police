"use client";

import { useEffect, useState, useTransition } from "react";
import {
  executeSearchWarrantAction,
  requestSearchMandateAppAction,
  type SearchWarrantResult,
} from "@/lib/game-session/app-actions";
import { AppFrame } from "./AppFrame";
import { RecordTable } from "./RecordTable";
import { PersonPicker, type PersonOption } from "./PersonPicker";
import type { MandateOverviewItem } from "@/lib/game-session/player-view";
import { playSound } from "@/lib/sound/sound-manager";

const KIND_LABEL: Record<string, string> = { search: "Perquisition", bank: "Bancaire" };

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
  const [requestState, setRequestState] = useState<{ granted: boolean; reason: string } | null>(null);
  const [warrantResult, setWarrantResult] = useState<SearchWarrantResult | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSelect = (personId: string) => {
    setSelected(people.find((p) => p.id === personId) ?? null);
    setRequestState(null);
    setWarrantResult(null);
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
      const res = await requestSearchMandateAppAction(selected.id);
      setRequestState(res);
      playSound(res.granted ? "success" : "denied");
    });
  };

  const executeSearch = () => {
    if (!selected) return;
    startTransition(async () => {
      const res = await executeSearchWarrantAction(selected.id);
      setWarrantResult(res);
      playSound("success");
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
                <span className={`stamp !py-0.5 !text-[9px] ${m.granted ? "stamp-blue" : "stamp-red"}`}>
                  {m.granted ? "Accordé" : "Refusé"}
                </span>
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
              <div className={`mt-3 border p-2 text-xs ${requestState.granted ? "border-success/40 text-success" : "border-danger/40 text-danger"}`}>
                {requestState.reason}
              </div>
            )}

            {requestState?.granted && (
              <button onClick={executeSearch} disabled={isPending} className="btn btn-primary mt-3">
                Exécuter la perquisition
              </button>
            )}
          </div>
        )}
      </div>

      {warrantResult && (
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
