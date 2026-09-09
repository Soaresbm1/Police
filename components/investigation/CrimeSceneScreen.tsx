"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import type { CrimeSceneHotspot } from "@/lib/game-session/crime-scene";
import { collectEvidenceAction, inspectCrimeSceneZoneAction, sendToLabAction } from "@/lib/game-session/actions";
import { RECORD_TYPE_LABEL } from "@/lib/game-session/labels";
import type { EvidenceReliability, EvidenceType, LabAnalysisType } from "@/lib/game-engine/types/evidence";
import type { EvidencePlayerStatus } from "@/lib/game-session/types";
import { playSound } from "@/lib/sound/sound-manager";
import { Soundscape } from "./Soundscape";
import { GeneratedImageWithFallback } from "./GeneratedImageWithFallback";
import { DESKTOP_CONTAINER_ASPECT, MOBILE_CONTAINER_ASPECT, resolveHotspotLayout } from "@/lib/art/hotspot-layout";

const WIDE_VIEWPORT_QUERY = "(min-width: 640px)"; // Tailwind's `sm` breakpoint, unmodified default

function subscribeToWideViewport(callback: () => void): () => void {
  const mql = window.matchMedia(WIDE_VIEWPORT_QUERY);
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

function getWideViewportSnapshot(): boolean {
  return window.matchMedia(WIDE_VIEWPORT_QUERY).matches;
}

/** Server snapshot: no `window` during SSR, so this matches the mobile
 * band the component's own `aspect-[4/5]` container renders by default
 * before any `sm:` override applies — keeps hydration consistent. */
function getWideViewportServerSnapshot(): boolean {
  return false;
}

/** Tracks Tailwind's `sm` breakpoint via `matchMedia` — only two fixed
 * aspect bands exist (see `CrimeSceneScreen`'s own `aspect-[4/5]
 * sm:aspect-[16/9]` container), so a boolean is all the coordinate
 * transform needs; no `ResizeObserver` required. `useSyncExternalStore` is
 * the correct primitive for subscribing to this kind of external browser
 * state — it re-renders on a real breakpoint change without ever calling
 * `setState` inside an effect. */
function useIsWideViewport(): boolean {
  return useSyncExternalStore(subscribeToWideViewport, getWideViewportSnapshot, getWideViewportServerSnapshot);
}

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
  generatedSceneBackground,
}: {
  hotspots: CrimeSceneHotspot[];
  evidenceDetails: EvidenceDetail[];
  locationName: string;
  locationAddress: string;
  victimName: string;
  autopsy: AutopsySummary;
  sceneBackground: string | null;
  /** Signed URL of the generated crime-scene environment, if `ready` —
   * resolved server-side by the parent page, never fetched from this
   * client component. Purely visual: hotspot coordinates and evidence
   * discovery below never read this value. */
  generatedSceneBackground?: string | null;
}) {
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const selected = hotspots.find((h) => h.zoneId === selectedZoneId) ?? null;
  const detail = selected?.evidenceId ? evidenceDetails.find((d) => d.evidenceId === selected.evidenceId) ?? null : null;

  const foundCount = hotspots.filter((h) => h.kind === "evidence" && h.discovered).length;
  const totalEvidence = hotspots.filter((h) => h.kind === "evidence").length;

  const isWide = useIsWideViewport();
  // Corrects each marker's on-screen position for the generated photo's
  // object-cover crop at the current breakpoint (see hotspot-layout.ts).
  // Never touches which hotspots exist, only where they're drawn — and
  // falls back to each hotspot's own untransformed x/y (today's
  // deterministic behavior) if the transform ever throws, so a bug here
  // can never hide a marker or block the scene.
  const resolvedPositions = useMemo(() => {
    const containerAspect = isWide ? DESKTOP_CONTAINER_ASPECT : MOBILE_CONTAINER_ASPECT;
    try {
      const resolved = resolveHotspotLayout(
        hotspots.map((h) => ({ id: h.zoneId, semanticAnchor: h.semanticAnchor, x: h.x, y: h.y })),
        containerAspect,
      );
      return new Map(resolved.map((r) => [r.hotspotId, { x: r.xPercent, y: r.yPercent }]));
    } catch {
      return new Map(hotspots.map((h) => [h.zoneId, { x: h.x, y: h.y }]));
    }
  }, [hotspots, isWide]);

  return (
    <div className="flex flex-col gap-3">
      <Soundscape kind="crime_scene" />
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <div>
          <p className="field-label">Scène de crime</p>
          <h1 className="text-xl font-bold uppercase tracking-wide text-foreground sm:text-2xl">{locationName}</h1>
        </div>
        <p className="text-sm text-muted">
          {locationAddress} — {foundCount}/{totalEvidence} élément(s) relevé(s)
        </p>
      </div>

      {/* The scene itself dominates the screen — a full-bleed illustrated
         background with subtle hotspot indicators; navigation/details are
         an overlay, never a large panel competing with the scene. Taller
         aspect ratio on narrow screens: 16/9 leaves very little vertical
         room for the scene once the shell's own chrome is subtracted, and
         a short box makes hotspots hard to tap precisely. */}
      <div className="panel relative aspect-[4/5] w-full overflow-hidden sm:aspect-[16/9]">
        {sceneBackground && (
          <GeneratedImageWithFallback
            proceduralSrc={sceneBackground}
            generatedSrc={generatedSceneBackground}
            className="absolute inset-0 h-full w-full"
            imgClassName="object-cover"
          />
        )}
        {/* Subtle scrim so hotspot markers stay readable regardless of a
           generated photo's own brightness/contrast — the procedural SVG
           background already darkens itself for evening/night internally,
           but a real photograph has no such guarantee. Static, no
           animation, so reduced-motion settings are irrelevant here. */}
        {sceneBackground && <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-black/10" />}

        {hotspots.map((h) => {
          const isSelected = h.zoneId === selectedZoneId;
          const dotColor = h.kind === "body" ? "bg-danger" : h.discovered ? "bg-success" : "bg-accent-strong";
          const position = resolvedPositions.get(h.zoneId) ?? { x: h.x, y: h.y };
          return (
            <button
              key={h.zoneId}
              type="button"
              onClick={() => setSelectedZoneId(h.zoneId)}
              style={{ left: `${position.x}%`, top: `${position.y}%` }}
              className="group absolute flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
              title={h.label}
              aria-label={h.label}
            >
              <span
                className={`relative flex h-3 w-3 items-center justify-center rounded-full ${dotColor} shadow-[0_0_0_1.5px_rgba(0,0,0,0.55),0_0_6px_1px_rgba(0,0,0,0.5)] transition-transform group-hover:scale-150 group-active:scale-150 ${
                  isSelected ? "ring-2 ring-accent-strong ring-offset-2 ring-offset-background-deep" : ""
                }`}
              >
                {!h.discovered && h.kind !== "body" && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${dotColor} opacity-60`} />}
              </span>
              <span className="pointer-events-none absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap bg-background-deep/85 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted opacity-0 transition-opacity group-hover:opacity-100 group-active:opacity-100">
                {h.label}
              </span>
            </button>
          );
        })}

        {/* Detail overlay — only present once a zone is selected, so the
           scene is unobstructed by default. A right-side drawer at
           `sm+` (room enough beside the scene image); a bottom sheet
           below it, since the image itself is short there and a
           right-anchored drawer would have almost no vertical room. */}
        {selected && (
          <div className="fade-up absolute inset-x-0 bottom-0 flex max-h-[70%] flex-col gap-3 overflow-y-auto border-t border-border-strong bg-background-deep/95 p-4 backdrop-blur-sm sm:inset-x-auto sm:inset-y-0 sm:bottom-auto sm:right-0 sm:max-h-none sm:w-[300px] sm:max-w-[80%] sm:border-l sm:border-t-0 sm:bg-background-deep/92">
            <div className="flex items-start justify-between">
              <div>
                <p className="data-id">ZONE {selected.zoneNumber.toString().padStart(2, "0")}</p>
                <h2 className="text-lg font-bold uppercase tracking-wide text-foreground">{selected.label}</h2>
              </div>
              <button
                type="button"
                onClick={() => setSelectedZoneId(null)}
                className="btn btn-ghost !px-2 !py-1 !text-xs"
                aria-label="Fermer le détail de la zone"
              >
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
