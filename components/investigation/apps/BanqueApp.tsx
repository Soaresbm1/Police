"use client";

import { useEffect, useState, useTransition } from "react";
import { requestBankMandateAppAction, searchBankAction, type BankSearchResult } from "@/lib/game-session/app-actions";
import { AppFrame } from "./AppFrame";
import { RecordTable } from "./RecordTable";
import { PersonPicker, type PersonOption } from "./PersonPicker";
import { playSound } from "@/lib/sound/sound-manager";

export function BanqueApp({ people, initialPersonId }: { people: PersonOption[]; initialPersonId?: string }) {
  const [selected, setSelected] = useState<PersonOption | null>(null);
  const [result, setResult] = useState<BankSearchResult | null>(null);
  const [isPending, startTransition] = useTransition();

  const refresh = (personId: string) => {
    startTransition(async () => {
      const res = await searchBankAction(personId);
      setResult(res);
      if (res.status === "ready") playSound("success");
    });
  };

  const handleSelect = (personId: string) => {
    const person = people.find((p) => p.id === personId) ?? null;
    setSelected(person);
    setResult(null);
    refresh(personId);
  };

  useEffect(() => {
    // Deliberate one-shot: a deep link from another app (e.g. a suspect's
    // profile, or the investigation-activity inbox) pre-selects them here
    // instead of making the player retype the name they already found.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (initialPersonId) handleSelect(initialPersonId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const requestMandate = () => {
    if (!selected) return;
    const personId = selected.id;
    startTransition(async () => {
      const outcome = await requestBankMandateAppAction(personId);
      // The decision itself is never known the instant this call returns
      // — requesting always resolves to "pending" until the
      // administrative delay has actually elapsed. If it turns out the
      // decision was already ready (e.g. re-requesting after coming
      // back), defer to the records flow for the up-to-date status
      // instead of duplicating its state machine here.
      if (outcome.status === "granted") {
        const res = await searchBankAction(personId);
        setResult(res);
      } else {
        setResult({ personId, ownerName: selected.name, status: outcome.status, mandateReason: outcome.reason, lines: [] });
      }
    });
  };

  return (
    <AppFrame title="Consultation bancaire" system="FINMA-REQ — Réquisition de données bancaires" accent="amber">
      <PersonPicker people={people} onSelect={handleSelect} />

      {isPending && <p className="font-data text-xs text-muted">Traitement de la demande…</p>}

      {!isPending && result && (
        <div className="panel p-4">
          <p className="field-label">Titulaire du compte</p>
          <p className="text-lg text-foreground">{result.ownerName}</p>

          {result.status === "no_mandate" && (
            <div className="mt-3 border border-warning/30 bg-warning/5 p-3">
              <p className="text-sm text-warning">Accès restreint — une réquisition judiciaire est requise pour consulter ce compte.</p>
              <p className="mt-1 text-xs text-muted">{result.mandateReason}</p>
              <button onClick={requestMandate} className="btn mt-2 !border-warning/60 !text-warning">
                Déposer une réquisition
              </button>
            </div>
          )}

          {(result.status === "pending" || result.status === "pending_records") && (
            <div className="mt-3 border border-border-strong bg-surface-sunken p-3">
              <p className="text-sm text-muted">
                {result.status === "pending" ? "Réquisition déposée — décision en attente." : "Réquisition accordée — documents en cours de transmission."}
              </p>
            </div>
          )}

          {result.status === "denied" && (
            <div className="mt-3 border border-danger/30 bg-danger-bg p-3">
              <p className="text-sm text-danger">{result.mandateReason}</p>
            </div>
          )}

          {result.status === "ready" && (
            <div className="mt-4 border-t border-border pt-3">
              <p className="field-label mb-2">Relevé de compte ({result.lines.length})</p>
              <RecordTable lines={result.lines} emptyLabel="Aucune opération notable sur ce compte." />
            </div>
          )}
        </div>
      )}
    </AppFrame>
  );
}
