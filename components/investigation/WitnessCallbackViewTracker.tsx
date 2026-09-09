"use client";

import { useEffect, useRef } from "react";
import { viewWitnessCallbackAction } from "@/lib/game-session/actions";

/**
 * Marks a `"ready"` witness callback `"seen"` once this component has
 * actually mounted — i.e. strictly after React has committed the callback
 * content to the DOM, never before. Renders nothing; `status` is passed
 * from the server-resolved `WitnessCallbackView` so this never fires for
 * an already-`"seen"` callback (the `useRef` guard additionally stops a
 * second call across React's dev-mode double-invoke/effect re-runs).
 */
export function WitnessCallbackViewTracker({ personId, status }: { personId: string; status: "ready" | "seen" }) {
  const firedRef = useRef(false);

  useEffect(() => {
    if (status !== "ready" || firedRef.current) return;
    firedRef.current = true;
    void viewWitnessCallbackAction(personId);
  }, [personId, status]);

  return null;
}
