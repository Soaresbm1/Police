"use client";

import { useState } from "react";
import type { MapLocationView } from "@/lib/game-session/player-view";
import { formatDuration } from "@/lib/game-engine/types/time";

const CATEGORY: Record<MapLocationView["category"], { label: string; color: string }> = {
  crime_scene: { label: "Scène de crime", color: "border-danger text-danger" },
  home: { label: "Domicile", color: "border-success text-success" },
  work: { label: "Lieu de travail", color: "border-link text-link" },
  evidence: { label: "Lié à une preuve", color: "border-accent text-accent-strong" },
};

export function InvestigationMap({ locations }: { locations: MapLocationView[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(locations.find((l) => l.category === "crime_scene")?.id ?? null);
  const selected = locations.find((l) => l.id === selectedId) ?? null;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <div>
        <p className="field-label">Géographie de l&apos;affaire</p>
        <h1 className="text-2xl font-bold uppercase tracking-wide text-foreground">Carte d&apos;enquête</h1>
        <p className="text-sm text-muted">
          Seuls les lieux déjà identifiés par l&apos;enquête apparaissent ici — domiciles, lieux de travail, scène de
          crime et lieux liés à une preuve découverte.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-[1fr_300px]">
        <div className="panel board-surface relative aspect-square w-full overflow-hidden">
          <div className="pointer-events-none absolute inset-0 border border-border-strong/40" />
          {locations.map((loc) => {
            const c = CATEGORY[loc.category];
            const isSelected = loc.id === selectedId;
            return (
              <button
                key={loc.id}
                type="button"
                onClick={() => setSelectedId(loc.id)}
                style={{ left: `${loc.x}%`, top: `${loc.y}%` }}
                className="group absolute -translate-x-1/2 -translate-y-1/2"
                title={loc.name}
              >
                <span
                  className={`block h-3.5 w-3.5 border-2 bg-surface-sunken transition-transform group-hover:scale-125 ${c.color} ${
                    isSelected ? "scale-150" : ""
                  } ${loc.category === "crime_scene" ? "rotate-45" : ""}`}
                />
              </button>
            );
          })}
          {selected && (
            <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
              {locations
                .filter((l) => l.category === "crime_scene" && l.id !== selected.id)
                .map((scene) => (
                  <line
                    key={scene.id}
                    x1={`${scene.x}%`}
                    y1={`${scene.y}%`}
                    x2={`${selected.x}%`}
                    y2={`${selected.y}%`}
                    stroke="var(--accent)"
                    strokeOpacity={0.35}
                    strokeDasharray="4 4"
                  />
                ))}
            </svg>
          )}
        </div>

        <div className="panel panel-bracketed flex flex-col gap-3 p-4">
          <p className="field-label">Légende</p>
          <div className="flex flex-col gap-1.5 text-xs">
            {(Object.keys(CATEGORY) as MapLocationView["category"][]).map((key) => (
              <div key={key} className="flex items-center gap-2">
                <span className={`h-2.5 w-2.5 border-2 bg-surface-sunken ${CATEGORY[key].color} ${key === "crime_scene" ? "rotate-45" : ""}`} />
                <span className="text-muted">{CATEGORY[key].label}</span>
              </div>
            ))}
          </div>

          <div className="hairline pt-3">
            {!selected ? (
              <p className="text-sm text-muted">Sélectionnez un lieu sur la carte.</p>
            ) : (
              <>
                <p className="data-id">{CATEGORY[selected.category].label.toUpperCase()}</p>
                <h2 className="text-base font-bold text-foreground">{selected.name}</h2>
                <p className="text-xs text-muted">{selected.address}</p>
                <p className="font-data text-[10px] uppercase tracking-wide text-muted-dim">Quartier : {selected.district}</p>
                {selected.occupantNames.length > 0 && (
                  <p className="mt-2 text-xs text-foreground">
                    Occupant(s) : {selected.occupantNames.join(", ")}
                  </p>
                )}
                {selected.discoveredEvidenceCount > 0 && (
                  <p className="mt-1 text-xs text-accent-strong">{selected.discoveredEvidenceCount} preuve(s) liée(s)</p>
                )}
                {selected.category !== "crime_scene" && (
                  <p className="mt-2 font-data text-xs text-muted">
                    Depuis la scène : {formatDuration(selected.travelMinutesFromSceneCar)} en voiture,{" "}
                    {formatDuration(selected.travelMinutesFromSceneFoot)} à pied
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
