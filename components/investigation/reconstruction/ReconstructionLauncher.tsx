"use client";

import { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { isUnityCctvEnabled } from "@/lib/art/unity-cctv-config";
import type { ReconstructionScenario } from "@/lib/game-engine/reconstruction/reconstruction-types";
import { playSound } from "@/lib/sound/sound-manager";
import { ReconstructionViewer } from "./ReconstructionViewer";

/**
 * Entry point to the 3D reconstruction on a resolved case. Nothing Unity-related loads until the player clicks.
 * Below the desktop breakpoint the button is not offered at all: the written reconstruction above stays the
 * experience, with a short note that the 3D version exists on a computer.
 */
export function ReconstructionLauncher({ scenario }: { scenario: ReconstructionScenario | null }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  if (!scenario || !isUnityCctvEnabled()) return null;

  return (
    <>
      <div className="panel flex flex-col items-center gap-2 p-5 text-center">
        <p className="field-label !mb-0 !text-accent-strong">Reconstitution des faits</p>
        <p className="text-sm text-muted">Reconstitution établie à partir des éléments confirmés de l&apos;enquête.</p>
        <button
          type="button"
          onClick={() => {
            playSound("click");
            setOpen(true);
          }}
          className="btn btn-primary mt-2 hidden !px-8 md:inline-flex"
        >
          Voir la reconstitution
        </button>
        <p className="mt-1 font-data text-[11px] text-muted md:hidden">La reconstitution 3D est disponible sur ordinateur.</p>
      </div>
      {/* Portaled: the reveal steps animate with a transform, which would otherwise trap this fixed overlay inside the step's box. */}
      {open && createPortal(<ReconstructionViewer scenario={scenario} onClose={close} />, document.body)}
    </>
  );
}
