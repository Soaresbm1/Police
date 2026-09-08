"use client";

import { useEffect } from "react";
import { ambience } from "@/lib/sound/sound-manager";

/** Ducks the ambient office bed for a moment when the player steps into an
 * interrogation room, giving the scene a beat of tension. Renders nothing. */
export function InterrogationAmbienceDuck() {
  useEffect(() => {
    ambience.duck(2000);
  }, []);
  return null;
}
