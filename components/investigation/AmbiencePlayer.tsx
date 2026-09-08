"use client";

import { useEffect } from "react";
import { ambience } from "@/lib/sound/sound-manager";

/** Starts the office room-tone ambience bed for the lifetime of the
 * investigation shell, stopping it on unmount (leaving the case). A
 * silent, purely presentational component — renders nothing. */
export function AmbiencePlayer() {
  useEffect(() => {
    ambience.start("office");
    return () => ambience.stop();
  }, []);
  return null;
}
