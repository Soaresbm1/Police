"use client";

import { useState, useTransition } from "react";
import { searchCameraAction, type CameraSearchResult } from "@/lib/game-session/app-actions";
import { AppFrame } from "./AppFrame";
import { playSound } from "@/lib/sound/sound-manager";
import { Soundscape } from "../Soundscape";
import { CCTVViewer } from "../CCTVViewer";

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
      // "pending" is not a conclusion of any kind — only a resolved,
      // ready result (with or without footage) or a genuinely
      // camera-less location get any sound at all.
      if (res.status === "ready") playSound(res.lines.length > 0 ? "success" : "notify");
      else if (res.status === "unavailable") playSound("notify");
    });
  };

  return (
    <AppFrame title="Vidéosurveillance" system="VIGIL — Réquisition de bandes de vidéosurveillance" accent="purple">
      <Soundscape kind="cctv" />
      <div className="panel p-4">
        <p className="text-xs text-muted">
          Les enregistrements sont archivés par tranches de 6 heures. Choisissez le lieu et le créneau à visionner.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="field-label">Lieu équipé de caméras</label>
            <select
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              className="mt-1 w-full border border-border-strong bg-surface-sunken px-3 py-2 text-sm text-foreground"
            >
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label">Créneau</label>
            <select
              value={slot}
              onChange={(e) => setSlot(e.target.value)}
              className="mt-1 w-full border border-border-strong bg-surface-sunken px-3 py-2 text-sm text-foreground"
            >
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
        <button onClick={handleSearch} disabled={isPending || !locationId} className="btn btn-primary mt-3">
          {isPending ? "Extraction…" : "Réquisitionner la bande"}
        </button>
      </div>

      {isPending && <p className="font-data text-xs text-muted">Extraction des bandes archivées…</p>}

      {!isPending && result && (
        <div className="panel overflow-hidden">
          <div className="scanlines relative flex items-center justify-between border-b border-border bg-surface-sunken px-4 py-2">
            <span className="font-data text-[11px] uppercase tracking-wide text-muted">
              {result.locationName} — {SLOT_LABELS[Math.floor((result.windowStart % MINUTES_PER_DAY) / 360)]}
            </span>
            {result.available && (
              <span className="flex items-center gap-1.5 font-data text-[10px] text-danger">
                <span className="h-1.5 w-1.5 animate-pulse bg-danger" />
                REC
              </span>
            )}
          </div>
          <div className="p-4">
            {result.status === "unavailable" ? (
              <p className="text-sm text-danger">Ce lieu n&apos;est pas équipé de caméras.</p>
            ) : result.status === "pending" ? (
              <p className="text-sm text-muted">Bande réquisitionnée auprès de l&apos;exploitant — en attente de transmission.</p>
            ) : (
              <>
                {result.lines.length === 0 && <p className="text-sm text-muted">Aucune image exploitable sur ce créneau.</p>}
                <div className="grid gap-3 sm:grid-cols-2">
                  {result.lines.map((line) => (
                    <CCTVViewer key={line.id} line={line} locationName={result.locationName} />
                  ))}
                </div>
                {result.moreOutsideWindow && (
                  <p className="mt-2 text-xs text-warning">
                    D&apos;autres séquences existent en dehors de ce créneau — essayez une autre tranche horaire.
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </AppFrame>
  );
}
