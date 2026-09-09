"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { searchPhoneAction, type PhoneSearchResult } from "@/lib/game-session/app-actions";
import { AppFrame } from "./AppFrame";
import { RecordTable } from "./RecordTable";
import { OnboardingHint } from "@/components/investigation/OnboardingHint";
import { playSound } from "@/lib/sound/sound-manager";

export function TelephonieApp({ initialQuery }: { initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery ?? "");
  const [result, setResult] = useState<PhoneSearchResult | null>(null);
  const [isPending, startTransition] = useTransition();

  const runSearch = (value: string) => {
    if (value.trim().length < 6) return;
    startTransition(async () => {
      const res = await searchPhoneAction(value.trim());
      setResult(res);
      // Only a real, ready result (or a confirmed no-subscriber) is worth
      // a success/denied tone — "pending" isn't a conclusion of any kind.
      if (res.status === "ready") playSound("success");
      else if (res.status === "not_found") playSound("denied");
    });
  };

  const handleSearch = () => runSearch(query);

  useEffect(() => {
    if (initialQuery) runSearch(initialQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately runs once for the initial deep link only
  }, []);

  return (
    <AppFrame title="Téléphonie" system="SIRENE — Registre des télécommunications" accent="blue">
      <OnboardingHint
        id="telephonie-alibi"
        text="Une déclaration peut être vérifiée grâce aux données téléphoniques : géolocalisation, appels, connexions Wi-Fi."
      />
      <div className="panel p-4">
        <label className="field-label">Numéro de téléphone</label>
        <p className="mt-0.5 text-xs text-muted">Recherche exacte — le numéro complet est requis.</p>
        <div className="mt-2 flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="079 XXX XX XX"
            className="flex-1 border border-border-strong bg-surface-sunken px-3 py-2 font-data text-sm text-foreground focus:border-link focus:outline-none"
          />
          <button onClick={handleSearch} disabled={isPending || query.trim().length < 6} className="btn btn-primary">
            {isPending ? "Recherche…" : "Rechercher"}
          </button>
        </div>
      </div>

      {isPending && <p className="font-data text-xs text-muted">Interrogation de l&apos;opérateur en cours…</p>}

      {!isPending && result && (
        <>
          {result.found ? (
            <div className="panel p-4">
              <p className="field-label">Abonné identifié</p>
              <p className="mt-1 text-lg text-foreground">
                <Link href={`/investigation/personnes/${result.personId}`} className="hover:underline">
                  {result.ownerName}
                </Link>
              </p>
              <p className="font-data text-xs text-muted">N° {result.query}</p>

              <div className="mt-4 border-t border-border pt-3">
                {result.status === "pending" ? (
                  <p className="text-sm text-muted">Relevé demandé auprès de l&apos;opérateur — en attente de transmission.</p>
                ) : (
                  <>
                    <p className="field-label mb-2">Relevé opérateur ({result.lines.length})</p>
                    <RecordTable lines={result.lines} emptyLabel="Aucune activité enregistrée pour ce numéro." />
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="border border-danger/30 bg-danger-bg p-4 text-sm text-danger">
              Aucun abonné trouvé pour le numéro « {result.query} ». Vérifiez la saisie.
            </div>
          )}
        </>
      )}
    </AppFrame>
  );
}
