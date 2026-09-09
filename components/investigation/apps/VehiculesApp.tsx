"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { searchVehicleAction, type VehicleSearchResult } from "@/lib/game-session/app-actions";
import { AppFrame } from "./AppFrame";
import { playSound } from "@/lib/sound/sound-manager";

export function VehiculesApp({ initialQuery }: { initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery ?? "");
  const [result, setResult] = useState<VehicleSearchResult | null>(null);
  const [isPending, startTransition] = useTransition();

  const runSearch = (value: string) => {
    if (value.trim().length < 3) return;
    startTransition(async () => {
      const res = await searchVehicleAction(value.trim());
      setResult(res);
      playSound(res.matches.length > 0 ? "success" : "denied");
    });
  };

  const handleSearch = () => runSearch(query);

  useEffect(() => {
    if (initialQuery) runSearch(initialQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately runs once for the initial deep link only
  }, []);

  return (
    <AppFrame title="Fichier des véhicules" system="OFROU — Registre cantonal des immatriculations" accent="green">
      <div className="panel p-4">
        <label className="field-label">Plaque d&apos;immatriculation</label>
        <p className="mt-0.5 text-xs text-muted">
          Saisie complète ou partielle acceptée (ex. « VD AB 123 » ou seulement « 123 »).
        </p>
        <div className="mt-2 flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="VD AB 123"
            className="flex-1 border border-border-strong bg-surface-sunken px-3 py-2 font-data text-base uppercase tracking-widest text-foreground focus:border-success focus:outline-none sm:text-sm"
          />
          <button onClick={handleSearch} disabled={isPending || query.trim().length < 3} className="btn btn-primary">
            {isPending ? "Recherche…" : "Rechercher"}
          </button>
        </div>
      </div>

      {isPending && <p className="font-data text-xs text-muted">Consultation du registre cantonal…</p>}

      {!isPending && result && (
        <div className="panel p-4">
          <p className="field-label">
            {result.matches.length} correspondance(s) pour « {result.query} »
          </p>
          {result.matches.length === 0 ? (
            <p className="mt-2 text-sm text-danger">Aucun véhicule immatriculé ne correspond à cette recherche.</p>
          ) : (
            <div className="mt-3 flex flex-col gap-2">
              {result.matches.length > 1 && (
                <p className="text-xs text-warning">
                  Plusieurs véhicules correspondent à une plaque partielle — recoupez avec d&apos;autres éléments pour identifier le bon.
                </p>
              )}
              {result.matches.map((m) => (
                <div key={m.personId} className="panel-sunken flex items-center gap-3 p-3 text-sm">
                  <span className="font-data border border-border-strong bg-surface px-2 py-1 tracking-[0.15em] text-success">
                    {m.plate}
                  </span>
                  <div>
                    <p className="text-foreground">{m.description}</p>
                    <p className="text-muted">
                      Propriétaire :{" "}
                      <Link href={`/investigation/personnes/${m.personId}`} className="text-foreground hover:underline">
                        {m.ownerName}
                      </Link>
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </AppFrame>
  );
}
