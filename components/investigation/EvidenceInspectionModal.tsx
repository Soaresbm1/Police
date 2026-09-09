"use client";

import { useState } from "react";
import type { VisibleEvidence } from "@/lib/game-session/player-view";
import { EvidenceVisual, EVIDENCE_KIND_LABEL, rendererKindForEvidence, evidenceTimestampLabel } from "@/lib/art/evidence-renderers";
import { RECORD_TYPE_LABEL } from "@/lib/game-session/labels";
import { playSound } from "@/lib/sound/sound-manager";

const RELIABILITY_LABEL: Record<string, string> = {
  reliable: "Fiable",
  partial: "Partielle",
  ambiguous: "Ambiguë",
  contaminated: "Contaminée",
  falsified: "Falsifiée",
};

const STATUS_LABEL: Record<string, string> = {
  discovered: "Découverte",
  collected: "Prélevée",
  sent_to_lab: "Envoyée au laboratoire",
  analyzed: "Analysée",
  archived: "Archivée",
};

/**
 * Full-screen evidence inspection — the exhibit dominates the view with
 * its metadata alongside, closer to examining physical evidence than
 * opening a modal from a website (req. 9).
 */
export function EvidenceInspectionTrigger({ evidence, label = "Examiner" }: { evidence: VisibleEvidence; label?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          playSound("click");
          setOpen(true);
        }}
        className="btn !px-3 !py-1 !text-[10px]"
      >
        {label}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background-deep/92 p-4 sm:p-6" onClick={() => setOpen(false)}>
          <div
            className="fade-up panel panel-bracketed flex max-h-[90dvh] w-full max-w-3xl flex-col gap-4 overflow-y-auto p-4 sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="field-label">{EVIDENCE_KIND_LABEL[rendererKindForEvidence(evidence.type)]}</p>
                <h2 className="text-lg font-bold uppercase tracking-wide text-foreground">{RECORD_TYPE_LABEL[evidence.type]}</h2>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost !px-2 !py-1 !text-xs">
                Fermer ✕
              </button>
            </div>

            <EvidenceVisual evidence={evidence} className="aspect-[3/2] w-full" />

            <p className="font-document text-sm text-foreground">{evidence.description}</p>

            <div className="hairline grid grid-cols-2 gap-3 pt-3 text-xs sm:grid-cols-3">
              <div>
                <p className="field-label">Relevée le</p>
                <p className="mt-0.5 font-data text-foreground">{evidenceTimestampLabel(evidence)}</p>
              </div>
              <div>
                <p className="field-label">Fiabilité</p>
                <p className="mt-0.5 text-foreground">{RELIABILITY_LABEL[evidence.reliability] ?? evidence.reliability}</p>
              </div>
              <div>
                <p className="field-label">Statut</p>
                <p className="mt-0.5 text-foreground">{STATUS_LABEL[evidence.playerStatus] ?? evidence.playerStatus}</p>
              </div>
              {evidence.requiresLabAnalysis && (
                <div>
                  <p className="field-label">Analyse requise</p>
                  <p className="mt-0.5 text-foreground">{evidence.requiresLabAnalysis}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
