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
  const [mandateChecked, setMandateChecked] = useState<{ granted: boolean; reason: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSelect = (personId: string) => {
    const person = people.find((p) => p.id === personId) ?? null;
    setSelected(person);
    setResult(null);
    setMandateChecked(null);
    startTransition(async () => {
      const res = await searchBankAction(personId);
      setResult(res);
      if (res.mandateGranted) playSound("success");
    });
  };

  useEffect(() => {
    // Deliberate one-shot: a deep link from another app (e.g. a suspect's
    // profile) pre-selects them here instead of making the player retype
    // the name they already found.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (initialPersonId) handleSelect(initialPersonId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const requestMandate = () => {
    if (!selected) return;
    startTransition(async () => {
      const mandate = await requestBankMandateAppAction(selected.id);
      setMandateChecked(mandate);
      playSound(mandate.granted ? "success" : "denied");
      if (mandate.granted) {
        const res = await searchBankAction(selected.id);
        setResult(res);
      }
    });
  };

  return (
    <AppFrame title="Consultation bancaire" system="FINMA-REQ — Réquisition de données bancaires" accent="amber">
      <PersonPicker people={people} onSelect={handleSelect} />

      {isPending && <p className="font-data text-xs text-muted">Traitement de la demande…</p>}

      {!isPending && result && (
        <div className="rounded border border-border bg-surface p-4">
          <p className="text-xs uppercase tracking-wide text-muted">Titulaire du compte</p>
          <p className="text-lg text-foreground">{result.ownerName}</p>

          {!result.mandateGranted ? (
            <div className="mt-3 rounded border border-warning/30 bg-warning/5 p-3">
              <p className="text-sm text-warning">Accès restreint — une réquisition judiciaire est requise pour consulter ce compte.</p>
              <p className="mt-1 text-xs text-muted">{mandateChecked?.reason ?? result.mandateReason}</p>
              <button
                onClick={requestMandate}
                className="mt-2 rounded bg-warning px-3 py-1.5 text-sm font-medium text-background hover:opacity-90"
              >
                Déposer une réquisition
              </button>
            </div>
          ) : (
            <div className="mt-4 border-t border-border pt-3">
              <p className="mb-2 text-xs uppercase tracking-wide text-muted">Relevé de compte ({result.lines.length})</p>
              <RecordTable lines={result.lines} emptyLabel="Aucune opération notable sur ce compte." />
            </div>
          )}
        </div>
      )}
    </AppFrame>
  );
}
