"use client";

import { useEffect } from "react";
import { ambience } from "@/lib/sound/sound-manager";
import { Soundscape } from "./Soundscape";

/** Ducks the ambient bed for a moment when the player steps into an
 * interrogation room (a beat of tension before the room's own low-tension
 * soundscape takes over). Renders nothing but the silent `Soundscape`. */
export function InterrogationAmbienceDuck() {
  useEffect(() => {
    ambience.duck(1200);
  }, []);
  return <Soundscape kind="interrogation" />;
}
