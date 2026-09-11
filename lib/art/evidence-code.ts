import { hashSeed } from "./hash";

/**
 * Deterministic, human-readable evidence reference (e.g. "EV-4821") shared
 * by every screen that displays one — previously reimplemented three times
 * (EvidenceCard.tsx, evidence-renderers.tsx, and implicitly wherever else
 * copied the pattern) with the same hash so they happened to agree, but
 * genuinely duplicated code. Centralized here so a lab report (which needs
 * the exact same code a player already saw on the evidence card) can never
 * drift from it.
 */
export function evidenceCode(id: string): string {
  return `EV-${((hashSeed(id) % 9000) + 1000).toString()}`;
}

/** Deterministic forensic-report reference, e.g. "RF-2026-0184" — derived
 * from the evidence id alone, so the same evidence always gets the same
 * report number regardless of when in-game it happens to be consulted. */
export function labReportCode(evidenceId: string, year: number): string {
  const n = (hashSeed(`report:${evidenceId}`) % 9000) + 1000;
  return `RF-${year}-${n.toString().padStart(4, "0")}`;
}
