"use client";

import { useState } from "react";
import type { CrimeSceneHotspot } from "@/lib/game-session/crime-scene";
import { collectEvidenceAction, inspectCrimeSceneZoneAction, sendToLabAction } from "@/lib/game-session/actions";
import { RECORD_TYPE_LABEL } from "@/lib/game-session/labels";
import type { EvidenceReliability, EvidenceType, LabAnalysisType } from "@/lib/game-engine/types/evidence";
import type { EvidencePlayerStatus } from "@/lib/game-session/types";
import { playSound } from "@/lib/sound/sound-manager";

interface EvidenceDetail {
  evidenceId: string;
  reliability: EvidenceReliability;
  playerStatus: EvidencePlayerStatus;
  requiresLabAnalysis: LabAnalysisType | null;
}

interface AutopsySummary {
  estimatedDeathWindowStart: string;
  estimatedDeathWindowEnd: string;
  causeOfDeath: string;
  bodyPosition: string;
  wounds: string[];
}

export function CrimeSceneScreen({
  hotspots,
  evidenceDetails,
  locationName,
  locationAddress,
  victimName,
  autopsy,
}: {
  hotspots: CrimeSceneHotspot[];
  evidenceDetails: EvidenceDetail[];
  locationName: string;
  locationAddress: string;
  victimName: string;
  autopsy: AutopsySummary;
}) {
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const selected = hotspots.find((h) => h.zoneId === selectedZoneId) ?? null;
  const detail = selected?.evidenceId ? evidenceDetails.find((d) => d.evidenceId === selected.evidenceId) ?? null : null;

  const foundCount = hotspots.filter((h) => h.kind === "evidence" && h.discovered).length;
  const totalEvidence = hotspots.filter((h) => h.kind === "evidence").length;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <div>
        <p className="field-label">Scène de crime</p>
        <h1 className="text-2xl font-bold uppercase tracking-wide text-foreground">{locationName}</h1>
        <p className="text-sm text-muted">
          {locationAddress} — {foundCount}/{totalEvidence} élément(s) relevé(s)
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-[1fr_320px]">
        <div className="panel board-surface relative aspect-[4/3] w-full overflow-hidden">
          {/* Stylized top-down room outline — deliberately abstract, not a real generated scene. */}
          <div className="pointer-events-none absolute inset-8 border border-border-strong/60" />
          <div className="pointer-events-none absolute inset-x-16 inset-y-24 border border-dashed border-border-strong/30" />

          {hotspots.map((h) => {
            const isSelected = h.zoneId === selectedZoneId;
            const stateColor =
              h.kind === "body"
                ? "border-danger text-danger"
                : h.discovered
                  ? "border-success text-success"
                  : "border-accent text-accent-strong";
            return (
              <button
                key={h.zoneId}
                type="button"
                onClick={() => setSelectedZoneId(h.zoneId)}
                style={{ left: `${h.x}%`, top: `${h.y}%` }}
                className={`group absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1`}
                title={h.label}
              >
                <span
                  className={`font-data flex h-8 w-8 items-center justify-center border-2 bg-surface-sunken text-xs font-bold transition-transform group-hover:scale-110 ${stateColor} ${
                    isSelected ? "ring-2 ring-accent-strong ring-offset-2 ring-offset-background-deep" : ""
                  } ${!h.discovered && h.kind !== "body" ? "animate-pulse" : ""}`}
                >
                  {h.zoneNumber.toString().padStart(2, "0")}
                </span>
                <span className="whitespace-nowrap bg-background-deep/80 px-1 text-[10px] uppercase tracking-wide text-muted opacity-0 transition-opacity group-hover:opacity-100">
                  {h.label}
                </span>
              </button>
            );
          })}
        </div>

        <div className="panel panel-bracketed flex flex-col gap-3 p-4">
          {!selected && (
            <p className="text-sm text-muted">
              Sélectionnez une zone numérotée sur la scène pour l&apos;examiner.
            </p>
          )}

          {selected && (
            <>
              <div>
                <p className="data-id">ZONE {selected.zoneNumber.toString().padStart(2, "0")}</p>
                <h2 className="text-lg font-bold uppercase tracking-wide text-foreground">{selected.label}</h2>
              </div>

              {selected.kind === "body" && (
                <div className="font-document flex flex-col gap-2 text-sm">
                  <p className="text-foreground">{victimName}</p>
                  <p className="text-muted">
                    Décès estimé entre{" "}
                    <span className="font-data text-foreground">{autopsy.estimatedDeathWindowStart}</span> et{" "}
                    <span className="font-data text-foreground">{autopsy.estimatedDeathWindowEnd}</span>
                  </p>
                  <p className="text-muted">
                    Cause : <span className="text-foreground">{autopsy.causeOfDeath}</span>
                  </p>
                  <p className="text-muted">
                    Position : <span className="text-foreground">{autopsy.bodyPosition}</span>
                  </p>
                  {autopsy.wounds.length > 0 && (
                    <p className="text-muted">
                      Blessures : <span className="text-foreground">{autopsy.wounds.join(", ")}</span>
                    </p>
                  )}
                </div>
              )}

              {selected.kind === "evidence" && !selected.discovered && (
                <form
                  action={inspectCrimeSceneZoneAction.bind(null, selected.zoneId, selected.evidenceId)}
                  onSubmit={() => playSound("click")}
                >
                  <button type="submit" className="btn btn-primary w-full">
                    Inspecter
                  </button>
                </form>
              )}

              {selected.kind === "evidence" && selected.discovered && (
                <div className="flex flex-col gap-3 text-sm">
                  <p className="font-data text-xs uppercase tracking-wide text-accent-strong">
                    {RECORD_TYPE_LABEL[selected.evidenceType as EvidenceType] ?? selected.evidenceType}
                  </p>
                  <p className="text-foreground">{selected.evidenceDescription}</p>
                  {detail && (
                    <>
                      <p className="text-xs text-muted">Fiabilité : {detail.reliability}</p>
                      <div className="flex flex-col gap-2">
                        {detail.playerStatus === "discovered" && (
                          <form action={collectEvidenceAction.bind(null, detail.evidenceId)} onSubmit={() => playSound("click")}>
                            <button type="submit" className="btn w-full">
                              Prélever
                            </button>
                          </form>
                        )}
                        {detail.requiresLabAnalysis && (detail.playerStatus === "discovered" || detail.playerStatus === "collected") && (
                          <form action={sendToLabAction.bind(null, detail.evidenceId)} onSubmit={() => playSound("notify")}>
                            <button type="submit" className="btn btn-primary w-full">
                              Envoyer au laboratoire
                            </button>
                          </form>
                        )}
                        {detail.playerStatus === "sent_to_lab" && <p className="text-xs text-warning">Analyse en cours…</p>}
                        {detail.playerStatus === "analyzed" && <p className="text-xs text-success">Analyse disponible au laboratoire.</p>}
                      </div>
                    </>
                  )}
                </div>
              )}

              {selected.kind === "decoy" && !selected.discovered && (
                <form
                  action={inspectCrimeSceneZoneAction.bind(null, selected.zoneId, null)}
                  onSubmit={() => playSound("click")}
                >
                  <button type="submit" className="btn btn-primary w-full">
                    Inspecter
                  </button>
                </form>
              )}

              {selected.kind === "decoy" && selected.discovered && <p className="text-sm text-muted">{selected.decoyLine}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
