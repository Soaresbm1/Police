"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import type { UnityCCTVScenario } from "@/lib/art/unity-cctv-bridge";
import { unityCctvHost } from "@/lib/art/unity-cctv-host";

/**
 * Phase U3.5 — thin per-viewer consumer of the page-level `unityCctvHost`
 * singleton (see that module for why: mounting/unmounting used to create a
 * fresh Unity instance every time, which is what caused the U3 black-canvas
 * bug on toggle/reopen). This component never calls `createUnityInstance`
 * or `Quit` itself — it only asks the host to show its persistent canvas
 * inside `containerRef` on mount, and to hide it again on unmount. The
 * underlying Unity engine survives across mounts, so re-showing after a
 * toggle just restarts the current scenario at t=0 instead of rebooting.
 */
export function UnityCCTVPlayer({ scenario, onFallback }: { scenario: UnityCCTVScenario; onFallback: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const consumerIdRef = useRef<symbol>(Symbol("unity-cctv-viewer"));
  const state = useSyncExternalStore(unityCctvHost.subscribe, unityCctvHost.getState, () => "idle" as const);

  useEffect(() => {
    const container = containerRef.current;
    const consumerId = consumerIdRef.current;
    if (!container) return;
    unityCctvHost.activate(consumerId, container, scenario, onFallback);
    return () => {
      unityCctvHost.deactivate(consumerId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario]);

  return (
    <div className="relative w-full">
      <div
        ref={containerRef}
        className="w-full border border-border-strong"
        style={{ aspectRatio: "16/9", display: state === "ready" ? "block" : "none" }}
        role="img"
        aria-label="Séquence de vidéosurveillance (rendu 3D)"
      />
      {state === "loading" && (
        <div className="flex aspect-video w-full items-center justify-center border border-border-strong bg-surface-sunken">
          <p className="font-data text-xs text-muted">Chargement du module 3D…</p>
        </div>
      )}
    </div>
  );
}
