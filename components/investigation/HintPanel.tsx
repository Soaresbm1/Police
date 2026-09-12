"use client";

import { useState } from "react";
import { getNextHintAction, escalateHintAction, getHintHistoryAction } from "@/lib/game-session/app-actions";
import type { HintPayload } from "@/lib/game-session/hints";
import type { HintHistoryView } from "@/lib/game-session/hints";
import { playSound } from "@/lib/sound/sound-manager";

/**
 * "AIDE À L'ENQUÊTE" — the investigation-guidance entry point (Motive &
 * Digital Evidence Phase 2). Deliberately player-initiated only: nothing
 * here ever pops up on its own (req. 16 — automatic stuck-detection is
 * explicitly out of scope). The panel only ever holds a `HintPayload`
 * (`{hintId, level, text}`) already rendered server-side — no priority,
 * category, or CaseTruth field ever reaches this component.
 */
export function HintPanel() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<HintPayload | null>(null);
  const [history, setHistory] = useState<HintHistoryView[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [loading, setLoading] = useState(false);

  const openPanel = () => {
    playSound("click");
    setOpen(true);
  };

  const requestHint = async () => {
    setLoading(true);
    setShowHistory(false);
    const res = await getNextHintAction();
    setCurrent(res);
    setLoading(false);
  };

  const escalate = async () => {
    if (!current || current.terminal) return;
    setLoading(true);
    const res = await escalateHintAction(current.hintId);
    setCurrent(res);
    setLoading(false);
  };

  const openHistory = async () => {
    playSound("click");
    setShowHistory(true);
    const res = await getHintHistoryAction();
    setHistory(res);
  };

  return (
    <>
      <button type="button" onClick={openPanel} className="btn btn-ghost !px-1.5 !py-1 !text-[9px] sm:!px-2 sm:!text-[10px]" title="Aide à l'enquête">
        <span className="sm:hidden">Aide</span>
        <span className="hidden sm:inline">Aide à l&apos;enquête</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background-deep/92 p-4 sm:p-6" onClick={() => setOpen(false)}>
          <div
            className="fade-up panel panel-bracketed flex max-h-[90dvh] w-full max-w-lg flex-col gap-4 overflow-y-auto p-4 sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="field-label">Aide à l&apos;enquête</p>
                <h2 className="text-lg font-bold uppercase tracking-wide text-foreground">
                  {showHistory ? "Indices déjà consultés" : "Vous souhaitez une piste ?"}
                </h2>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost !px-2 !py-1 !text-xs">
                Fermer ✕
              </button>
            </div>

            {showHistory ? (
              <div className="flex flex-col gap-2">
                {!history && <p className="text-sm text-muted">Chargement…</p>}
                {history && history.length === 0 && <p className="text-sm text-muted">Aucun indice consulté pour l&apos;instant.</p>}
                {history?.map((h, i) => (
                  <div key={i} className="panel-sunken p-2.5 text-sm">
                    <p className="font-data text-[10px] uppercase tracking-wide text-muted">
                      Indice {h.level} — {h.timeLabel}
                    </p>
                    <p className="mt-1 text-foreground">{h.text}</p>
                  </div>
                ))}
                <button type="button" onClick={() => setShowHistory(false)} className="btn !self-start !px-3 !py-1 !text-[10px]">
                  ← Retour
                </button>
              </div>
            ) : (
              <>
                {!current && (
                  <>
                    <p className="text-sm text-muted">
                      Une piste d&apos;investigation peut vous être proposée. Elle ne révèle jamais la solution de l&apos;affaire.
                    </p>
                    <button type="button" onClick={requestHint} disabled={loading} className="btn btn-primary !self-start">
                      {loading ? "…" : "Obtenir un indice"}
                    </button>
                  </>
                )}

                {current && (
                  <div className="flex flex-col gap-3">
                    <p className="field-label">{current.terminal ? "Bilan de l'enquête" : `Indice — niveau ${current.level}`}</p>
                    <p className="font-document text-sm text-foreground">{current.text}</p>
                    {!current.terminal && (
                      <>
                        {current.level >= 2 && (
                          <p className="text-xs text-warning">Les indices avancés peuvent légèrement réduire votre score final.</p>
                        )}
                        <div className="flex flex-wrap gap-2">
                          <button type="button" onClick={requestHint} disabled={loading} className="btn !px-3 !py-1 !text-[10px]">
                            Une autre piste
                          </button>
                          {current.level < 3 && (
                            <button type="button" onClick={escalate} disabled={loading} className="btn btn-primary !px-3 !py-1 !text-[10px]">
                              Indice plus précis
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}

                <button type="button" onClick={openHistory} className="hairline mt-1 self-start pt-3 text-xs text-link hover:underline">
                  Historique des indices
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
