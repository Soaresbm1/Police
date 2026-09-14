"use client";

import { useEffect, useState, useTransition } from "react";
import { searchCameraAction, type CameraSearchResult } from "@/lib/game-session/app-actions";
import { AppFrame } from "./AppFrame";
import { playSound } from "@/lib/sound/sound-manager";
import { Soundscape } from "../Soundscape";
import { CCTVViewer } from "../CCTVViewer";
import { unityCctvHost } from "@/lib/art/unity-cctv-host";

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

/**
 * Phase U3.7 — pure resolver for which location id the `<select>` should
 * actually hold. `location.id` values are themselves stable and
 * deterministic (same seed → same ids, see
 * lib/game-engine/case-generator/__tests__/location-id-stability.test.ts) —
 * the failure mode this fixes isn't id generation, it's `CamerasApp`
 * holding onto a `locationId` in React state that no longer appears in a
 * *new* `locations` prop (the server component re-rendered with a
 * different active case — most commonly because the session backing it
 * was lost and recreated, see withSession/MemoryStore). Submitting that
 * stale id used to silently resolve to "Lieu inconnu" server-side. Called
 * from a `useEffect` below so it only ever runs in response to `locations`
 * actually changing, never during render.
 */
export function resolveValidLocationId(locations: CameraLocationOption[], currentId: string): string {
  if (locations.some((l) => l.id === currentId)) return currentId;
  return locations[0]?.id ?? "";
}

export function CamerasApp({ locations, initialLocationId }: { locations: CameraLocationOption[]; initialLocationId?: string }) {
  const [locationId, setLocationId] = useState(initialLocationId ?? locations[0]?.id ?? "");
  const [slot, setSlot] = useState(slotKey(1, 2));
  const [result, setResult] = useState<CameraSearchResult | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Self-heals if `locations` changes out from under this mounted component
  // (see resolveValidLocationId above) — without this, a stale locationId
  // survives in state and every subsequent search silently targets a
  // location that no longer exists. Adjusted directly during render (React's
  // own recommended pattern for "adjusting state when a prop changes",
  // guarded by comparing against the last-seen `locations` reference) rather
  // than in a useEffect, so it takes effect in the same commit instead of
  // triggering a cascading extra render.
  const [prevLocations, setPrevLocations] = useState(locations);
  if (locations !== prevLocations) {
    setPrevLocations(locations);
    const resolved = resolveValidLocationId(locations, locationId);
    if (resolved !== locationId) {
      setLocationId(resolved);
      setResult(null);
    }
  }

  // CamerasApp is the "investigation page" boundary for the persistent
  // Unity CCTV instance (Phase U3.5) — it's the true host lifecycle: Quit()
  // only happens here, when the Cameras app itself unmounts, never on a
  // clip's modal open/close/toggle (see lib/art/unity-cctv-host.ts).
  // Debounced via scheduleDispose()/cancelScheduledDispose() so React 18
  // StrictMode's dev-only mount→cleanup→remount cycle never tears down a
  // live instance.
  useEffect(() => {
    unityCctvHost.cancelScheduledDispose();
    return () => unityCctvHost.scheduleDispose();
  }, []);

  const handleSearch = () => {
    if (!locationId) return;
    const [day, quarter] = slot.split("-").map(Number);
    const { start, end } = slotWindow(day, quarter);
    startTransition(async () => {
      try {
        const res = await searchCameraAction(locationId, start, end);
        setResult(res);
        setSearchError(null);
        // "pending" is not a conclusion of any kind — only a resolved,
        // ready result (with or without footage) or a genuinely
        // camera-less location get any sound at all.
        if (res.status === "ready") playSound(res.lines.length > 0 ? "success" : "notify");
        else if (res.status === "unavailable") playSound("notify");
      } catch {
        // Most commonly withSession's "Aucune enquête en cours." — the
        // session backing this page vanished between render and submit
        // (see resolveValidLocationId above for the same root cause hitting
        // the location list). Surface it inline instead of letting an
        // uncaught server-action rejection crash the whole page.
        setResult(null);
        setSearchError("La session d'enquête est introuvable. Rechargez la page pour continuer.");
      }
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

      {!isPending && searchError && <p className="text-sm text-danger">{searchError}</p>}

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
