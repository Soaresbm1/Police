"use client";

import { useState } from "react";
import type { CrimeSceneHotspot } from "@/lib/game-session/crime-scene";
import { collectEvidenceAction, inspectCrimeSceneZoneAction, sendToLabAction } from "@/lib/game-session/actions";
import { RECORD_TYPE_LABEL } from "@/lib/game-session/labels";
import type { EvidenceReliability, EvidenceType, LabAnalysisType } from "@/lib/game-engine/types/evidence";
import type { EvidencePlayerStatus } from "@/lib/game-session/types";
import { playSound } from "@/lib/sound/sound-manager";
import { Soundscape } from "./Soundscape";

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
  sceneBackground,
}: {
  hotspots: CrimeSceneHotspot[];
  evidenceDetails: EvidenceDetail[];
  locationName: string;
  locationAddress: string;
  victimName: string;
  autopsy: AutopsySummary;
  sceneBackground: string | null;
}) {
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const selected = hotspots.find((h) => h.zoneId === selectedZoneId) ?? null;
  const detail = selected?.evidenceId ? evidenceDetails.find((d) => d.evidenceId === selected.evidenceId) ?? null : null;

  const foundCount = hotspots.filter((h) => h.kind === "evidence" && h.discovered).length;
  const totalEvidence = hotspots.filter((h) => h.kind === "evidence").length;

  return (
    <div className="flex flex-col gap-3">
      <Soundscape kind="crime_scene" />
      <div className="flex items-baseline justify-between">
        <div>
          <p className="field-label">Scène de crime</p>
          <h1 className="text-2xl font-bold uppercase tracking-wide text-foreground">{locationName}</h1>
        </div>
        <p className="text-sm text-muted">
          {locationAddress} — {foundCount}/{totalEvidence} élément(s) relevé(s)
        </p>
      </div>

      {/* The scene itself dominates the screen — a full-bleed illustrated
         background with subtle hotspot indicators; navigation/details are
         an overlay, never a large panel competing with the scene. */}
      <div className="panel relative aspect-[16/9] w-full overflow-hidden">
        {sceneBackground && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={sceneBackground} alt="" className="absolute inset-0 h-full w-full object-cover" />
        )}

        {hotspots.map((h) => {
          const isSelected = h.zoneId === selectedZoneId;
          const dotColor = h.kind === "body" ? "bg-danger" : h.discovered ? "bg-success" : "bg-accent-strong";
          return (
            <button
              key={h.zoneId}
              type="button"
              onClick={() => setSelectedZoneId(h.zoneId)}
              style={{ left: `${h.x}%`, top: `${h.y}%` }}
              className="group absolute -translate-x-1/2 -translate-y-1/2 p-2"
              title={h.label}
            >
              <span
                className={`relative flex h-3 w-3 items-center justify-center rounded-full ${dotColor} transition-transform group-hover:scale-150 ${
                  isSelected ? "ring-2 ring-accent-strong ring-offset-2 ring-offset-background-deep" : ""
                }`}
              >
                {!h.discovered && h.kind !== "body" && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${dotColor} opacity-60`} />}
              </span>
              <span className="pointer-events-none absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap bg-background-deep/85 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted opacity-0 transition-opacity group-hover:opacity-100">
                {h.label}
              </span>
            </button>
          );
        })}

        {/* Compact overlay drawer — only present once a zone is selected,
           so the scene is unobstructed by default. */}
        {selected && (
          <div className="fade-up absolute inset-y-0 right-0 flex w-[300px] max-w-[80%] flex-col gap-3 border-l border-border-strong bg-background-deep/92 p-4 backdrop-blur-sm">
            <div className="flex items-start justify-between">
              <div>
                <p className="data-id">ZONE {selected.zoneNumber.toString().padStart(2, "0")}</p>
                <h2 className="text-lg font-bold uppercase tracking-wide text-foreground">{selected.label}</h2>
              </div>
              <button type="button" onClick={() => setSelectedZoneId(null)} className="btn btn-ghost !px-2 !py-1 !text-xs">
                ✕
              </button>
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
              <form action={inspectCrimeSceneZoneAction.bind(null, selected.zoneId, selected.evidenceId)} onSubmit={() => playSound("click")}>
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
              <form action={inspectCrimeSceneZoneAction.bind(null, selected.zoneId, null)} onSubmit={() => playSound("click")}>
                <button type="submit" className="btn btn-primary w-full">
                  Inspecter
                </button>
              </form>
            )}

            {selected.kind === "decoy" && selected.discovered && <p className="text-sm text-muted">{selected.decoyLine}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
