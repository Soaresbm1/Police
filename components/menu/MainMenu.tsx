"use client";

import Link from "next/link";
import { useState } from "react";
import { startNewCase } from "@/lib/game-session/actions";
import { signOutAction } from "@/lib/supabase/auth-actions";
import { SettingsOverlay } from "@/components/shell/SettingsOverlay";
import { rankForXp, nextRank } from "@/lib/game-session/career";
import type { PlayerProfile } from "@/lib/game-session/persistence";

const DIFFICULTIES = [
  { value: "recruit", label: "Recrue", description: "Assistance renforcée, peu de suspects." },
  { value: "investigator", label: "Enquêteur", description: "Expérience standard." },
  { value: "inspector", label: "Inspecteur", description: "Davantage de bruit, témoignages moins fiables." },
  { value: "expert", label: "Expert", description: "Presque aucune aide, preuves ambiguës." },
];

export function MainMenu({
  hasActiveCase,
  resumeHref,
  supabaseConfigured,
  authenticated,
  displayEmail,
  profile,
  caseHistoryCount,
}: {
  hasActiveCase: boolean;
  resumeHref: string;
  supabaseConfigured: boolean;
  authenticated: boolean;
  displayEmail: string | null;
  profile: PlayerProfile | null;
  caseHistoryCount: number;
}) {
  const [panel, setPanel] = useState<"none" | "new-case">("none");
  const requiresLogin = supabaseConfigured && !authenticated;

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

        {profile && (
          <div className="fade-up flex w-full items-center justify-between border border-border-strong bg-surface px-4 py-2.5 text-xs">
            <div>
              <p className="font-semibold uppercase tracking-wide text-accent-strong">{rankForXp(profile.xp)}</p>
              {displayEmail && <p className="text-muted-dim">{displayEmail}</p>}
            </div>
            <div className="text-right text-muted">
              <p>{profile.xp} XP</p>
              <p>{profile.casesSolved} affaire(s) résolue(s)</p>
            </div>
          </div>
        )}

        {panel === "none" && requiresLogin && (
          <nav className="fade-up flex w-full flex-col gap-2">
            <Link href="/login" className="btn btn-primary w-full !justify-between !py-3 !text-[13px]">
              <span>Se connecter / Créer un compte</span>
              <span aria-hidden>→</span>
            </Link>
            <div className="mt-2 flex justify-center">
              <SettingsOverlay
                inGame={false}
                initialReduceMotion={profile?.settings.reduceMotion}
                initialHintsDisabled={profile?.settings.hintsDisabled}
              />
            </div>
          </nav>
        )}

        {panel === "none" && !requiresLogin && (
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
            <Link href="/dossiers" className="btn w-full !justify-between !py-3 !text-[13px]">
              <span>Dossiers archivés</span>
              <span className="text-[10px] text-muted-dim">{caseHistoryCount}</span>
            </Link>
            <button type="button" disabled className="btn w-full !justify-between !py-3 !text-[13px]">
              <span>Statistiques</span>
              <span className="text-[10px] text-muted-dim">bientôt</span>
            </button>
            <div className="mt-2 flex items-center justify-center gap-2">
              <SettingsOverlay
                inGame={false}
                initialReduceMotion={profile?.settings.reduceMotion}
                initialHintsDisabled={profile?.settings.hintsDisabled}
              />
              {supabaseConfigured && (
                <form action={signOutAction}>
                  <button type="submit" className="btn btn-ghost !px-2 !py-1 !text-[10px]">
                    Se déconnecter
                  </button>
                </form>
              )}
            </div>
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

        {profile && nextRank(profile.xp) && panel === "none" && !requiresLogin && (
          <p className="font-data text-[10px] text-muted-dim">
            Prochain grade : {nextRank(profile.xp)!.name} (encore {nextRank(profile.xp)!.xpNeeded} XP)
          </p>
        )}

        <p className="font-data text-[10px] tracking-[0.1em] text-muted-dim">CASELINE v0.10 — build interne</p>
      </div>
    </div>
  );
}
