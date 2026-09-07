"use client";

import { useState } from "react";
import { startNewCase } from "@/lib/game-session/actions";

const DIFFICULTIES = [
  { value: "recruit", label: "Recrue", description: "Assistance renforcée, peu de suspects." },
  { value: "investigator", label: "Enquêteur", description: "Expérience standard." },
  { value: "inspector", label: "Inspecteur", description: "Davantage de bruit, témoignages moins fiables." },
  { value: "expert", label: "Expert", description: "Presque aucune aide, preuves ambiguës." },
];

export function MainMenu({ hasActiveCase, resumeHref }: { hasActiveCase: boolean; resumeHref: string }) {
  const [panel, setPanel] = useState<"none" | "new-case">("none");

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background-deep">
      <div className="menu-sweep pointer-events-none absolute inset-0" />
      <div className="crt-vignette" />

      <div className="relative z-10 flex w-full max-w-md flex-col items-center gap-10 px-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="flex h-14 w-14 items-center justify-center border-2 border-accent text-2xl font-bold text-accent-strong">
            C
          </span>
          <h1 className="mt-3 text-4xl font-bold tracking-[0.3em] text-foreground">CASELINE</h1>
          <p className="font-data text-[11px] uppercase tracking-[0.32em] text-muted">
            Système d&apos;enquête policière
          </p>
        </div>

        {panel === "none" && (
          <nav className="fade-up flex w-full flex-col gap-2">
            {hasActiveCase && (
              <a href={resumeHref} className="btn btn-primary w-full !justify-between !py-3 !text-[13px]">
                <span>Continuer l&apos;enquête</span>
                <span aria-hidden>→</span>
              </a>
            )}
            <button
              type="button"
              onClick={() => setPanel("new-case")}
              className="btn w-full !justify-between !py-3 !text-[13px]"
            >
              <span>Nouvelle affaire</span>
              <span aria-hidden>→</span>
            </button>
            <button type="button" disabled className="btn w-full !justify-between !py-3 !text-[13px]">
              <span>Dossiers archivés</span>
              <span className="text-[10px] text-muted-dim">bientôt</span>
            </button>
            <button type="button" disabled className="btn w-full !justify-between !py-3 !text-[13px]">
              <span>Statistiques</span>
              <span className="text-[10px] text-muted-dim">bientôt</span>
            </button>
          </nav>
        )}

        {panel === "new-case" && (
          <form action={startNewCase} className="fade-up flex w-full flex-col gap-3">
            <div className="panel p-4">
              <p className="field-label mb-3">Niveau d&apos;enquête</p>
              <div className="flex flex-col gap-2">
                {DIFFICULTIES.map((d) => (
                  <label
                    key={d.value}
                    className="flex cursor-pointer items-start gap-3 border border-border-strong p-2.5 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent/10"
                  >
                    <input type="radio" name="difficulty" value={d.value} defaultChecked={d.value === "investigator"} className="mt-1" />
                    <span>
                      <span className="block font-medium text-foreground">{d.label}</span>
                      <span className="block text-xs text-muted">{d.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
            {hasActiveCase && (
              <p className="text-center text-[11px] text-warning">
                Démarrer une nouvelle affaire remplacera l&apos;enquête en cours.
              </p>
            )}
            <div className="flex gap-2">
              <button type="button" onClick={() => setPanel("none")} className="btn flex-1">
                Retour
              </button>
              <button type="submit" className="btn btn-primary flex-[2]">
                Ouvrir un nouveau dossier
              </button>
            </div>
          </form>
        )}

        <p className="font-data text-[10px] tracking-[0.1em] text-muted-dim">CASELINE v0.10 — build interne</p>
      </div>
    </div>
  );
}
