"use client";

import { useEffect, useState } from "react";
import { Avatar } from "./Avatar";

interface CaseIntroOverlayProps {
  seed: string;
  /** Display-only case reference (`CL-2026-0421`); `seed` stays the
   * storage key so the intro still plays exactly once per case. */
  caseNumber: string;
  crimeType: string;
  victimName: string;
  victimAvatarSeed: string;
  locationName: string;
  locationAddress: string;
  reportedAtLabel: string;
}

const STEP_DELAY_MS = 850;

export function CaseIntroOverlay({
  seed,
  caseNumber,
  crimeType,
  victimName,
  victimAvatarSeed,
  locationName,
  locationAddress,
  reportedAtLabel,
}: CaseIntroOverlayProps) {
  const storageKey = `caseline:intro-shown:${seed}`;
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);
  const totalSteps = 4;

  useEffect(() => {
    try {
      // One-shot read of browser storage to decide whether to play the
      // intro — unavoidable outside render since sessionStorage doesn't
      // exist during SSR.
      if (!sessionStorage.getItem(storageKey)) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setVisible(true);
      }
    } catch {
      // sessionStorage unavailable — skip the intro rather than block play
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!visible || step >= totalSteps) return;
    const t = setTimeout(() => setStep((s) => s + 1), STEP_DELAY_MS);
    return () => clearTimeout(t);
  }, [visible, step]);

  const finish = () => {
    try {
      sessionStorage.setItem(storageKey, "1");
    } catch {
      // ignore
    }
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-background-deep px-6 text-center">
      <div className="crt-vignette" />
      <button
        type="button"
        onClick={finish}
        className="absolute right-6 top-6 z-10 font-data text-[11px] uppercase tracking-widest text-muted hover:text-foreground"
      >
        Passer [échap]
      </button>

      <div className="relative z-10 flex max-w-md flex-col items-center gap-4">
        {step >= 0 && (
          <p className="fade-up font-data text-xs uppercase tracking-[0.25em] text-success">
            Connexion sécurisée établie
          </p>
        )}
        {step >= 1 && (
          <p className="fade-up font-data text-xs uppercase tracking-[0.25em] text-muted">Dossier reçu</p>
        )}
        {step >= 2 && (
          <div className="fade-up flex flex-col items-center gap-1">
            <p className="data-id text-base">{caseNumber}</p>
            <p className="text-2xl font-bold uppercase tracking-[0.15em] text-danger">{crimeType}</p>
          </div>
        )}
        {step >= 3 && (
          <div className="fade-up flex flex-col items-center gap-3 border border-border bg-surface px-6 py-5">
            <Avatar seed={victimAvatarSeed} name={victimName} size={64} />
            <p className="text-lg font-semibold text-foreground">{victimName}</p>
            <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-left">
              <div>
                <p className="field-label">Lieu</p>
                <p className="text-sm text-foreground">{locationName}</p>
                <p className="text-xs text-muted">{locationAddress}</p>
              </div>
              <div>
                <p className="field-label">Signalé</p>
                <p className="font-data text-sm text-foreground">{reportedAtLabel}</p>
              </div>
            </div>
          </div>
        )}
        {step >= totalSteps && (
          <button type="button" onClick={finish} className="btn btn-primary fade-up mt-2 !px-8 !py-3">
            Ouvrir le dossier
          </button>
        )}
      </div>
    </div>
  );
}
