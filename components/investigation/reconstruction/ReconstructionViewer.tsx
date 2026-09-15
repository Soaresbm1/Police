"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type MouseEvent } from "react";
import { ReconstructionPlayer, type PlayerSnapshot } from "@/lib/art/reconstruction-player";
import { detectUnityCctvCapability, shouldAttemptUnityCctv } from "@/lib/art/unity-cctv-config";
import { unityCctvHost } from "@/lib/art/unity-cctv-host";
import { currentMarker, formatElapsed, truthToBar, type PresentationTimeline } from "@/lib/game-engine/reconstruction/reconstruction-presentation";
import type { ReconstructionScenario } from "@/lib/game-engine/reconstruction/reconstruction-types";
import { playSound } from "@/lib/sound/sound-manager";

const SPEEDS = [0.5, 1, 2] as const;

/** Labels closer than this (in % of the bar) to the previous label on the same row drop to a second row. */
const MIN_LABEL_SPACING_PERCENT = 14;

function labelRows(positions: number[]): number[] {
  let lastOnFirstRow = -Infinity;
  return positions.map((position) => {
    if (position - lastOnFirstRow >= MIN_LABEL_SPACING_PERCENT) {
      lastOnFirstRow = position;
      return 0;
    }
    return 1;
  });
}

export function ReconstructionViewer({ scenario, onClose }: { scenario: ReconstructionScenario; onClose: () => void }) {
  // Checked once, when the player opens the viewer; an unsupported browser never loads the Unity runtime.
  const [capable] = useState(() => shouldAttemptUnityCctv(detectUnityCctvCapability()));

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background-deep/92 p-4 sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reconstruction-title"
        className="fade-up panel panel-bracketed flex max-h-[94dvh] w-full max-w-5xl flex-col gap-4 overflow-y-auto p-4 sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="field-label">Dossier classé</p>
            <h2 id="reconstruction-title" className="text-lg font-bold uppercase tracking-wide text-foreground">
              Reconstitution des faits
            </h2>
            <p className="mt-1 text-sm text-muted">Reconstitution établie à partir des éléments confirmés de l&apos;enquête.</p>
          </div>
          <button type="button" onClick={onClose} className="btn btn-ghost shrink-0 !px-2 !py-1 !text-xs">
            Fermer ✕
          </button>
        </div>

        {capable ? (
          <ReconstructionStage scenario={scenario} onClose={onClose} />
        ) : (
          <p className="border border-border-strong bg-surface-sunken p-4 text-sm text-muted">La reconstitution 3D est disponible sur ordinateur.</p>
        )}
      </div>
    </div>
  );
}

function ReconstructionStage({ scenario, onClose }: { scenario: ReconstructionScenario; onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [player] = useState(() => new ReconstructionPlayer(scenario, unityCctvHost));
  const snapshot = useSyncExternalStore(player.subscribe, player.getSnapshot, player.getSnapshot);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    player.mount(container);
    return () => player.unmount();
  }, [player]);

  const controlsEnabled = snapshot.status === "ready" && !snapshot.transitioning;
  const marker = currentMarker(player.timeline, snapshot.truthTime);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative w-full overflow-hidden border border-border-strong bg-background-deep" style={{ aspectRatio: "16 / 10" }}>
        <div ref={containerRef} className="absolute inset-0" role="img" aria-label="Reconstitution 3D des faits" />
        <StageOverlay snapshot={snapshot} onRetry={() => player.retry()} onClose={onClose} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!controlsEnabled}
          onClick={() => {
            playSound("click");
            player.togglePlay();
          }}
          className="btn btn-primary min-w-[6rem] !px-4 !py-1.5 !text-xs"
        >
          {snapshot.playing ? "Pause" : "Lecture"}
        </button>
        <button
          type="button"
          disabled={!controlsEnabled}
          onClick={() => {
            playSound("click");
            player.restart();
          }}
          className="btn !px-3 !py-1.5 !text-xs"
        >
          Recommencer
        </button>
        <div className="flex border border-border-strong" role="group" aria-label="Vitesse de lecture">
          {SPEEDS.map((speed) => (
            <button
              key={speed}
              type="button"
              aria-pressed={snapshot.speed === speed}
              onClick={() => player.setSpeed(speed)}
              className={`px-2.5 py-1 font-data text-[11px] ${snapshot.speed === speed ? "bg-accent text-background-deep" : "text-muted hover:text-foreground"}`}
            >
              {speed === 0.5 ? "0,5×" : `${speed}×`}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-baseline gap-3">
          {marker && <span className="font-data text-[11px] uppercase tracking-widest text-accent-strong">{marker.label}</span>}
          <span className="font-data text-sm text-foreground" title="Temps écoulé depuis le début de la reconstitution">
            {formatElapsed(snapshot.truthTime)}
          </span>
        </div>
      </div>

      <SemanticTimeline
        timeline={player.timeline}
        truthTime={snapshot.truthTime}
        enabled={controlsEnabled}
        onSeekBar={(bar) => player.seekToBar(bar)}
        onSeekTruth={(time) => player.seekToTruth(time)}
      />

      <p className="font-data text-[10px] italic text-warning">Reconstitution visuelle — positions spatiales indicatives</p>
    </div>
  );
}

function StageOverlay({ snapshot, onRetry, onClose }: { snapshot: PlayerSnapshot; onRetry: () => void; onClose: () => void }) {
  if (snapshot.status === "error") {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background-deep p-6 text-center">
        <p className="text-sm text-foreground">La reconstitution n&apos;a pas pu être chargée.</p>
        <div className="flex gap-2">
          <button type="button" onClick={onRetry} className="btn btn-primary !px-4 !py-1.5 !text-xs">
            Réessayer
          </button>
          <button type="button" onClick={onClose} className="btn btn-ghost !px-4 !py-1.5 !text-xs">
            Fermer
          </button>
        </div>
      </div>
    );
  }

  if (snapshot.status !== "ready") {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-background-deep">
        <p className="font-data text-xs text-muted">{snapshot.status === "booting" ? "Chargement du module 3D…" : "Préparation de la reconstitution…"}</p>
      </div>
    );
  }

  if (snapshot.transitioning) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-background-deep/85">
        <p className="fade-up font-document text-2xl italic text-foreground">Plus tard…</p>
      </div>
    );
  }

  return null;
}

function SemanticTimeline({
  timeline,
  truthTime,
  enabled,
  onSeekBar,
  onSeekTruth,
}: {
  timeline: PresentationTimeline;
  truthTime: number;
  enabled: boolean;
  onSeekBar: (bar: number) => void;
  onSeekTruth: (truthTime: number) => void;
}) {
  const percent = (bar: number) => (timeline.barDuration > 0 ? (bar / timeline.barDuration) * 100 : 0);

  const onTrackClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!enabled) return;
    const rect = event.currentTarget.getBoundingClientRect();
    onSeekBar(((event.clientX - rect.left) / rect.width) * timeline.barDuration);
  };

  return (
    <div className="flex flex-col gap-1">
      <div className={`relative h-6 ${enabled ? "cursor-pointer" : "opacity-60"}`} onClick={onTrackClick}>
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 bg-border" />
        {timeline.segments
          .filter((segment) => segment.kind === "gap")
          .map((gap) => (
            <div
              key={gap.barStart}
              title="Plus tard…"
              className="absolute top-1/2 h-3 -translate-y-1/2 border-x border-border-strong bg-[repeating-linear-gradient(135deg,transparent_0_3px,rgba(255,255,255,0.18)_3px_4px)]"
              style={{ left: `${percent(gap.barStart)}%`, width: `${percent(gap.barEnd) - percent(gap.barStart)}%` }}
            />
          ))}
        <div className="absolute left-0 top-1/2 h-1 -translate-y-1/2 bg-accent" style={{ width: `${percent(truthToBar(timeline, truthTime))}%` }} />
        {timeline.markers.map((marker, index) => (
          <button
            key={`${marker.type}-${index}`}
            type="button"
            disabled={!enabled}
            title={marker.label}
            aria-label={`${marker.label}, ${formatElapsed(marker.truthTime)}`}
            onClick={(event) => {
              event.stopPropagation();
              onSeekTruth(marker.truthTime);
            }}
            className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent-strong bg-background-deep enabled:hover:bg-accent-strong"
            style={{ left: `${percent(marker.barPosition)}%` }}
          />
        ))}
      </div>
      <div className="relative h-8">
        {labelRows(timeline.markers.map((marker) => percent(marker.barPosition))).map((row, index) => {
          const marker = timeline.markers[index];
          const left = percent(marker.barPosition);
          const align = left < 6 ? "translate-x-0" : left > 94 ? "-translate-x-full" : "-translate-x-1/2";
          return (
            <span
              key={`${marker.type}-label-${index}`}
              className={`absolute whitespace-nowrap font-data text-[10px] uppercase tracking-wide text-muted ${align} ${row === 0 ? "top-0" : "top-4"}`}
              style={{ left: `${left}%` }}
            >
              {marker.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}
