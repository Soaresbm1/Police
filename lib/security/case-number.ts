import "server-only";

import { isLegacyCaseSeed } from "@/lib/game-engine/random/rng";
import { formatCaseNumber } from "@/lib/game-engine/world/city";
import { computeCaseRef } from "./case-ref";

/**
 * Security S1 — the player-visible dossier number (`CL-2026-0421`).
 *
 * Legacy cases keep `formatCaseNumber(seed)` so every existing case keeps
 * its number. For strong-format cases the number is computed from the
 * keyed `caseRef` instead, so the ~13 bits it displays reveal nothing about
 * the seed itself. Display format and per-case stability are unchanged.
 */
export function displayCaseNumber(seed: string): string {
  return formatCaseNumber(isLegacyCaseSeed(seed) ? seed : computeCaseRef(seed));
}
