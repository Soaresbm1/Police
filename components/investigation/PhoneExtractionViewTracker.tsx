"use client";

import { useEffect, useRef } from "react";
import { markEventSeenAction } from "@/lib/game-session/actions";

/**
 * Marks the victim-phone device's `lab_result` event `"seen"` once this
 * component has actually mounted on the Extraction mobile page — mirrors
 * `WitnessCallbackViewTracker`. This is what lets the investigation-
 * guidance hint engine (`hints.ts`) know the phone has genuinely been
 * opened: `buildPhoneUnreadOpportunity` stops firing, and
 * `buildPhoneFinancialCrossRefOpportunity` only starts being eligible,
 * the instant this fires — reusing the existing event system rather than
 * adding a new persisted "phone read" flag.
 */
export function PhoneExtractionViewTracker({ eventId, status }: { eventId: string | null; status: "ready" | "seen" | null }) {
  const firedRef = useRef(false);

  useEffect(() => {
    if (!eventId || status !== "ready" || firedRef.current) return;
    firedRef.current = true;
    void markEventSeenAction(eventId);
  }, [eventId, status]);

  return null;
}
