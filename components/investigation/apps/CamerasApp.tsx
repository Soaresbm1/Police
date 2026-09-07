"use client";

import { useState, useTransition } from "react";
import { searchCameraAction, type CameraSearchResult } from "@/lib/game-session/app-actions";
import { AppFrame } from "./AppFrame";
import { RecordTable } from "./RecordTable";
import { playSound } from "@/lib/sound/sound-manager";

export interface CameraLocationOption {
  id: string;
  name: string;
}

const SLOT_LABELS = ["00:00 – 06:00", "06:00 – 12:00", "12:00 – 18:00", "18:00 – 24:00"];
const MINUTES_PER_DAY = 1440;

function slotKey(day: number, quarter: number): string {
  return `${day}-${quarter}`;
}

function slotWindow(day: number, quarter: number): { start: number; end: number } {
  const dayOffset = (day - 1) * MINUTES_PER_DAY;
  const start = dayOffset + quarter * 360;
  return { start, end: start + 360 };
}

export function CamerasApp({ locations, initialLocationId }: { locations: CameraLocationOption[]; initialLocationId?: string }) {
  const [locationId, setLocationId] = useState(initialLocationId ?? locations[0]?.id ?? "");
  const [slot, setSlot] = useState(slotKey(1, 2));
  const [result, setResult] = useState<CameraSearchResult | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSearch = () => {
    if (!locationId) return;
    const [day, quarter] = slot.split("-").map(Number);
    const { start, end } = slotWindow(day, quarter);
    startTransition(async () => {
      const res = await searchCameraAction(locationId, start, end);
      setResult(res);
      playSound(res.available && res.lines.length > 0 ? "success" : "notify");
    });
  };

  return (
    <AppFrame title="Vidéosurveillance" system="VIGIL — Réquisition de bandes de vidéosurveillance" accent="purple">
      <div className="rounded border border-border bg-surface p-4">
        <p className="text-xs text-muted">
          Les enregistrements sont archivés par tranches de 6 heures. Choisissez le lieu et le créneau à visionner.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-xs uppercase tracking-wide text-muted">Lieu équipé de caméras</label>
            <select
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              className="mt-1 w-full rounded border border-border-strong bg-background px-3 py-2 text-sm text-foreground"
            >
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide text-muted">Créneau</label>
            <select value={slot} onChange={(e) => setSlot(e.target.value)} className="mt-1 w-full rounded border border-border-strong bg-background px-3 py-2 text-sm text-foreground">
              {[1, 2].map((day) =>
                SLOT_LABELS.map((label, quarter) => (
                  <option key={slotKey(day, quarter)} value={slotKey(day, quarter)}>
                    Jour {day}, {label}
                  </option>
                )),
              )}
            </select>
          </div>
        </div>
        <button
          onClick={handleSearch}
          disabled={isPending || !locationId}
          className="mt-3 rounded bg-[#a97fd9] px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isPending ? "Extraction…" : "Réquisitionner la bande"}
        </button>
      </div>

      {isPending && <p className="font-data text-xs text-muted">Extraction des bandes archivées…</p>}

      {!isPending && result && (
        <div className="rounded border border-border bg-surface p-4">
          <p className="text-xs uppercase tracking-wide text-muted">
            {result.locationName} — {SLOT_LABELS[Math.floor((result.windowStart % MINUTES_PER_DAY) / 360)]}
          </p>
          {!result.available ? (
            <p className="mt-2 text-sm text-danger">Ce lieu n&apos;est pas équipé de caméras.</p>
          ) : (
            <>
              <div className="mt-3 border-t border-border pt-3">
                <RecordTable lines={result.lines} emptyLabel="Aucune image exploitable sur ce créneau." />
              </div>
              {result.moreOutsideWindow && (
                <p className="mt-2 text-xs text-warning">
                  D&apos;autres séquences existent en dehors de ce créneau — essayez une autre tranche horaire.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </AppFrame>
  );
}
