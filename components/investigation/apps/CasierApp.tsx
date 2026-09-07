"use client";

import { useEffect, useState, useTransition } from "react";
import { searchCriminalRecordAction, type CriminalRecordResult } from "@/lib/game-session/app-actions";
import { AppFrame } from "./AppFrame";
import { PersonPicker, type PersonOption } from "./PersonPicker";
import { playSound } from "@/lib/sound/sound-manager";

export function CasierApp({ people, initialPersonId }: { people: PersonOption[]; initialPersonId?: string }) {
  const [result, setResult] = useState<CriminalRecordResult | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSelect = (personId: string) => {
    startTransition(async () => {
      const res = await searchCriminalRecordAction(personId);
      setResult(res);
      playSound(res.entries.length > 0 ? "alert" : "notify");
    });
  };

  useEffect(() => {
    if (initialPersonId) handleSelect(initialPersonId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately runs once for the initial deep link only
  }, []);

  return (
    <AppFrame title="Casier judiciaire" system="CASIJUD — Extrait du casier judiciaire" accent="amber">
      <PersonPicker people={people} onSelect={handleSelect} />

      {isPending && <p className="font-data text-xs text-muted">Interrogation du registre central…</p>}

      {!isPending && result && (
        <div className="panel p-4">
          <p className="field-label">Extrait pour</p>
          <p className="text-lg text-foreground">{result.ownerName}</p>
          <div className="mt-3 border-t border-border pt-3">
            {result.entries.length === 0 ? (
              <p className="text-sm text-success">Casier judiciaire vierge.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {result.entries.map((entry, i) => (
                  <li key={i} className="border border-warning/30 bg-warning/5 p-2 text-sm">
                    <span className="font-data text-xs text-warning">il y a {entry.yearsAgo} an(s)</span>
                    <p className="text-foreground">{entry.offense}</p>
                    <p className="text-xs text-muted">Décision : {entry.outcome}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </AppFrame>
  );
}
