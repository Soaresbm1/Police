"use client";

import { useRef, useState } from "react";
import { getLabReportAction, consultLabReportAction } from "@/lib/game-session/app-actions";
import type { LabReportView as LabReportViewType } from "@/lib/game-session/lab-report";
import { playSound } from "@/lib/sound/sound-manager";

/**
 * Trigger + modal for consulting a completed lab report (req. 2). Data is
 * fetched on open rather than passed as a prop, following the same
 * on-demand pattern as the other apps (`CamerasApp`/`BanqueApp`) — this
 * component only needs an evidence id, not `truth`/`session` threaded
 * through every caller. The first successful open also marks the
 * matching `lab_result` event `seen` (REPORT READY → REPORT CONSULTED),
 * reusing the existing event status machine rather than a new field.
 */
export function LabReportTrigger({ evidenceId, label = "Consulter le rapport" }: { evidenceId: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<LabReportViewType | null>(null);
  const [loading, setLoading] = useState(false);
  const consultedRef = useRef(false);

  const handleOpen = () => {
    playSound("click");
    setOpen(true);
    setLoading(true);
    void (async () => {
      const res = await getLabReportAction(evidenceId);
      setReport(res);
      setLoading(false);
      if (res && !consultedRef.current) {
        consultedRef.current = true;
        void consultLabReportAction(evidenceId);
      }
    })();
  };

  return (
    <>
      <button type="button" onClick={handleOpen} className="btn btn-primary !px-3 !py-1 !text-[10px]">
        {label}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background-deep/92 p-4 sm:p-6" onClick={() => setOpen(false)}>
          <div
            className="fade-up panel panel-bracketed flex max-h-[90dvh] w-full max-w-2xl flex-col gap-4 overflow-y-auto p-4 sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="field-label">Rapport d&apos;analyse</p>
                <h2 className="text-lg font-bold uppercase tracking-wide text-foreground">{report ? report.reportId : "…"}</h2>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost !px-2 !py-1 !text-xs">
                Fermer ✕
              </button>
            </div>

            {loading && <p className="text-sm text-muted">Chargement du rapport…</p>}
            {!loading && !report && <p className="text-sm text-danger">Rapport indisponible.</p>}
            {!loading && report && (
              <>
                <div className="hairline grid grid-cols-2 gap-3 pt-3 text-xs sm:grid-cols-3">
                  <div>
                    <p className="field-label">Preuve</p>
                    <p className="mt-0.5 font-data text-foreground">{report.evidenceCode}</p>
                  </div>
                  <div>
                    <p className="field-label">Type</p>
                    <p className="mt-0.5 text-foreground">{report.evidenceTypeLabel}</p>
                  </div>
                  <div>
                    <p className="field-label">Analyse</p>
                    <p className="mt-0.5 text-foreground">{report.analysisTypeLabel}</p>
                  </div>
                  <div>
                    <p className="field-label">Origine</p>
                    <p className="mt-0.5 text-foreground">{report.origin}</p>
                  </div>
                  <div>
                    <p className="field-label">Soumis le</p>
                    <p className="mt-0.5 font-data text-foreground">{report.submittedAtLabel}</p>
                  </div>
                  <div>
                    <p className="field-label">Terminé le</p>
                    <p className="mt-0.5 font-data text-foreground">{report.completedAtLabel}</p>
                  </div>
                </div>

                <div className="hairline pt-3">
                  <p className="field-label">Résultat</p>
                  <p className="mt-1 text-sm font-semibold text-foreground">
                    {report.resultLabel} <span className="font-normal text-muted">({report.reliabilityLabel})</span>
                  </p>
                </div>

                <div className="hairline pt-3">
                  <p className="field-label">Interprétation</p>
                  <p className="font-document mt-1 text-sm text-foreground">{report.interpretation}</p>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
