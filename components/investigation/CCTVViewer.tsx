"use client";

import { useMemo, useState } from "react";
import { cctvFrameDataUri } from "@/lib/art/cctv-renderer";
import type { CameraRecordLine } from "@/lib/game-session/app-actions";
import { playSound } from "@/lib/sound/sound-manager";
import { CCTVAnimatedPlayer } from "./CCTVAnimatedPlayer";
import { UnityCCTVPlayer } from "./UnityCCTVPlayer";
import { mapCCTVSequenceToUnityScenario } from "@/lib/art/unity-cctv-bridge";
import { detectUnityCctvCapability, shouldAttemptUnityCctv } from "@/lib/art/unity-cctv-config";

/**
 * Single abstraction over "what a CCTV frame looks like to the player" —
 * tries the embedded Unity 3D renderer first (Phase U3), falling back to
 * the Canvas `CCTVAnimatedPlayer` (Phase 3) if Unity is disabled,
 * unsupported, or fails/times out, and finally to the original static still
 * when `line.sequence` never resolved at all. Every call site goes through
 * this component rather than rendering `<img>`/`<video>`/`<canvas>`
 * directly, so the visual technology can keep evolving without touching
 * `CamerasApp` (req. 13/22). Renders only what `CameraRecordLine` already
 * carries — never fabricates a detail beyond the immutable
 * `CCTVFrameDescriptor`/`CCTVSequenceDescriptor` (req. 11).
 *
 * Unity's ~20MB runtime is loaded lazily and ONLY once this modal is
 * actually open (req. 28/29) — capability detection and the Unity attempt
 * both happen inside the `open` branch below, never on mount.
 */
export function CCTVViewer({ line, locationName }: { line: CameraRecordLine; locationName: string }) {
  const [open, setOpen] = useState(false);
  const [unityFailed, setUnityFailed] = useState(false);
  const [forcedCanvas, setForcedCanvas] = useState(false);

  const openDetail = () => {
    playSound("click");
    setOpen(true);
  };

  const closeDetail = () => {
    setOpen(false);
    setUnityFailed(false);
    setForcedCanvas(false);
  };

  // Capability check is a synchronous, side-effect-free read of the
  // browser (WebAssembly/WebGL2/viewport width) — computed directly during
  // render rather than via useEffect+setState, and only while the modal is
  // actually open, so it's re-derived fresh each time a clip is opened
  // without ever running before then. This IS the lazy boundary (req.
  // 28/29): nothing Unity-related is considered until `open` is true.
  const capabilityAllowsUnity = useMemo(() => {
    if (!open || typeof window === "undefined") return false;
    return shouldAttemptUnityCctv(detectUnityCctvCapability());
  }, [open]);

  const unityScenario = useMemo(() => (line.sequence ? mapCCTVSequenceToUnityScenario(line.sequence) : null), [line.sequence]);

  const showUnity = capabilityAllowsUnity && !unityFailed && !forcedCanvas && unityScenario !== null;
  const showCanvasFallbackNotice = unityFailed && !forcedCanvas;

  return (
    <div className="flex flex-col gap-1.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={cctvFrameDataUri(line.frame)} alt="" className="w-full cursor-pointer border border-border-strong" onClick={openDetail} />
      <p className="font-data text-[10px] uppercase tracking-wide text-muted">
        {line.timeLabel} — {line.qualityLabel}
      </p>
      <p className="text-xs text-foreground">{line.observation}</p>
      <button type="button" onClick={openDetail} className="btn !self-start !px-2 !py-1 !text-[10px]">
        Examiner
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background-deep/92 p-4 sm:p-6" onClick={closeDetail}>
          <div
            className="fade-up panel panel-bracketed flex max-h-[90dvh] w-full max-w-xl flex-col gap-4 overflow-y-auto p-4 sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="field-label">Vidéosurveillance</p>
                <h2 className="text-lg font-bold uppercase tracking-wide text-foreground">{line.cameraId}</h2>
              </div>
              <button type="button" onClick={closeDetail} className="btn btn-ghost !px-2 !py-1 !text-xs">
                Fermer ✕
              </button>
            </div>

            {showUnity && unityScenario ? (
              <UnityCCTVPlayer scenario={unityScenario} onFallback={() => setUnityFailed(true)} />
            ) : line.sequence ? (
              <CCTVAnimatedPlayer sequence={line.sequence} />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={cctvFrameDataUri(line.frame)} alt="" className="w-full border border-border-strong" />
            )}

            {showCanvasFallbackNotice && <p className="font-data text-[10px] text-muted">Rendu 3D indisponible — affichage standard.</p>}

            {process.env.NODE_ENV !== "production" && line.sequence && (
              <button
                type="button"
                onClick={() => setForcedCanvas((v) => !v)}
                className="btn btn-ghost self-start !px-2 !py-1 !text-[10px]"
                title="QA uniquement — bascule manuelle entre le rendu Unity et le rendu Canvas pour comparaison"
              >
                {forcedCanvas ? "QA : afficher rendu 3D" : "QA : forcer rendu standard"}
              </button>
            )}

            <div className="hairline grid grid-cols-2 gap-3 pt-3 text-xs sm:grid-cols-3">
              <div>
                <p className="field-label">Caméra</p>
                <p className="mt-0.5 font-data text-foreground">{line.cameraId}</p>
              </div>
              <div>
                <p className="field-label">Emplacement</p>
                <p className="mt-0.5 text-foreground">{locationName}</p>
              </div>
              <div>
                <p className="field-label">Horodatage</p>
                <p className="mt-0.5 font-data text-foreground">{line.timeLabel}</p>
              </div>
              <div>
                <p className="field-label">Qualité</p>
                <p className="mt-0.5 text-foreground">{line.qualityLabel}</p>
              </div>
              <div className="col-span-2 sm:col-span-3">
                <p className="field-label">Observation</p>
                <p className="mt-0.5 text-foreground">{line.observation}</p>
              </div>
              <div className="col-span-2 sm:col-span-3">
                <p className="field-label">Identification</p>
                <p className="mt-0.5 text-foreground">
                  {line.identifiedNames.length > 0 ? line.identifiedNames.join(", ") : "Aucune identification possible sur cette image."}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
