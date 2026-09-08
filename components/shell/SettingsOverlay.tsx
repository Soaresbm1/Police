"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { getVolume, isSoundMuted, onSoundMuteChange, playSound, setSoundMuted, setVolume, type VolumeGroup } from "@/lib/sound/sound-manager";
import { updateSettingsAction } from "@/lib/game-session/profile-actions";

export function SettingsOverlay({
  inGame,
  difficultyLabel,
  initialReduceMotion = false,
  initialHintsDisabled = false,
}: {
  inGame: boolean;
  difficultyLabel?: string;
  initialReduceMotion?: boolean;
  initialHintsDisabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [muted, setMuted] = useState(true);
  const [volumes, setVolumes] = useState<Record<VolumeGroup, number>>({ master: 0.8, ui: 0.8, ambience: 0.35 });
  const [reduceMotion, setReduceMotion] = useState(initialReduceMotion);
  const [hintsDisabled, setHintsDisabled] = useState(initialHintsDisabled);
  const [, startTransition] = useTransition();

  useEffect(() => {
    // One-shot read of the sound preferences after mount — these stay
    // client-only (see profile-actions.ts) so the Web Audio graph never
    // needs a server round trip to check them.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMuted(isSoundMuted());
    setVolumes({ master: getVolume("master"), ui: getVolume("ui"), ambience: getVolume("ambience") });
    return onSoundMuteChange(setMuted);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) return;
      setOpen((o) => !o);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn btn-ghost !px-2 !py-1 !text-[10px]"
        title="Paramètres (Échap)"
      >
        Paramètres
      </button>
    );
  }

  const toggleReduceMotion = () => {
    const next = !reduceMotion;
    setReduceMotion(next);
    document.documentElement.dataset.reduceMotion = String(next);
    startTransition(() => {
      updateSettingsAction({ reduceMotion: next });
    });
  };

  const toggleHints = () => {
    const next = !hintsDisabled;
    setHintsDisabled(next);
    try {
      // OnboardingHint reads this same key directly for zero-latency effect;
      // the profile write below is what makes the preference follow the
      // player across devices/sessions.
      localStorage.setItem("caseline:hints-disabled", String(next));
    } catch {
      // ignore
    }
    startTransition(() => {
      updateSettingsAction({ hintsDisabled: next });
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background-deep/80" onClick={() => setOpen(false)}>
      <div className="panel panel-bracketed w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold uppercase tracking-wide text-foreground">Paramètres</h2>
          <button type="button" onClick={() => setOpen(false)} className="font-data text-xs text-muted hover:text-foreground">
            [échap]
          </button>
        </div>

        <div className="flex flex-col gap-4 text-sm">
          <label className="flex items-center justify-between">
            <span className="text-foreground">Son</span>
            <button
              type="button"
              onClick={() => {
                const next = !muted;
                setSoundMuted(next);
                if (!next) playSound("click");
              }}
              className="btn !px-3 !py-1 !text-[10px]"
            >
              {muted ? "Coupé" : "Activé"}
            </button>
          </label>

          {(["master", "ambience", "ui"] as VolumeGroup[]).map((group) => (
            <label key={group} className="flex flex-col gap-1">
              <span className="flex items-center justify-between text-xs text-muted">
                <span>{group === "master" ? "Volume général" : group === "ambience" ? "Ambiance" : "Interface"}</span>
                <span className="font-data">{Math.round(volumes[group] * 100)}%</span>
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={volumes[group]}
                disabled={muted}
                onChange={(e) => {
                  const value = Number(e.target.value);
                  setVolumes((v) => ({ ...v, [group]: value }));
                  setVolume(group, value);
                }}
                className="accent-accent"
              />
            </label>
          ))}

          <label className="flex items-center justify-between">
            <span className="text-foreground">Animations réduites</span>
            <button type="button" onClick={toggleReduceMotion} className="btn !px-3 !py-1 !text-[10px]">
              {reduceMotion ? "Activées" : "Désactivées"}
            </button>
          </label>

          <label className="flex items-center justify-between">
            <span className="text-foreground">Astuces de démarrage</span>
            <button type="button" onClick={toggleHints} className="btn !px-3 !py-1 !text-[10px]">
              {hintsDisabled ? "Masquées" : "Affichées"}
            </button>
          </label>

          {inGame && difficultyLabel && (
            <div className="hairline flex items-center justify-between pt-3">
              <span className="text-muted">Niveau d&apos;enquête</span>
              <span className="text-foreground">{difficultyLabel}</span>
            </div>
          )}

          <div className="hairline flex flex-col gap-2 pt-3">
            <Link href="/" className="btn w-full">
              Menu principal
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
