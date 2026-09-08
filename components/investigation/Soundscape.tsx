"use client";

import { useEffect } from "react";
import { ambience, type AmbienceKind } from "@/lib/sound/sound-manager";

/**
 * Switches the ambience bed to `kind` for as long as this screen is
 * mounted, restoring the shell's default office room-tone on unmount.
 * `AmbiencePlayer` (mounted once for the whole investigation shell) starts
 * "office" and never changes it on its own — this is the per-screen
 * override that fills that gap. A silent, purely presentational
 * component; renders nothing.
 */
export function Soundscape({ kind }: { kind: AmbienceKind }) {
  useEffect(() => {
    ambience.start(kind);
    return () => ambience.start("office");
  }, [kind]);
  return null;
}
