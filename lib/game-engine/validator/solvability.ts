import type { CaseTruth } from "../types/case";

export type SolvabilityChannel =
  | "motive"
  | "physical"
  | "video"
  | "digital"
  | "financial"
  | "alibi_contradiction"
  | "testimony_lie"
  | "accomplice_evidence"
  | "tampering_trace"
  | "staging_tell";

export interface SolvabilityResult {
  score: number;
  independentChannels: SolvabilityChannel[];
  /** True if at least one counted channel's underlying evidence directly
   * implicates the real culprit — guards against a case that's technically
   * "solvable" only via evidence pointing at an accomplice. */
  culpritDirectlyImplicated: boolean;
}

export const MIN_INDEPENDENT_CHANNELS = 3;

/**
 * Counts independent "channels" of proof against the true culprit. The rule
 * from the design spec is simple but important: the solution must never rest
 * on a single fragile clue (e.g. one fingerprint). We require several
 * structurally different kinds of evidence to converge — mirroring how a
 * real investigation builds a case (motive + presence + physical evidence,
 * or a broken alibi + geolocation + a financial trail). Tampering, staging,
 * and accomplice involvement each contribute their own channel too — a case
 * that suppresses its physical evidence via tampering still needs to remain
 * solvable through the trace that tampering itself leaves behind.
 */
export function computeSolvability(caseTruth: CaseTruth): SolvabilityResult {
  const channels = new Set<SolvabilityChannel>();
  let culpritDirectlyImplicated = false;

  if (caseTruth.motive.strength > 0.2) channels.add("motive");

  const incriminating = caseTruth.evidence.filter(
    (e) => !e.isRedHerring && e.relatedPersonIds.includes(caseTruth.culpritId),
  );
  for (const evidence of incriminating) {
    if (evidence.family === "physical") channels.add("physical");
    if (evidence.family === "video") channels.add("video");
    if (evidence.family === "digital") channels.add("digital");
    if (evidence.family === "financial") channels.add("financial");
    culpritDirectlyImplicated = true;
  }

  const culpritAlibi = caseTruth.alibis.find((a) => a.personId === caseTruth.culpritId);
  if (culpritAlibi && !culpritAlibi.isTrue && culpritAlibi.contradictingEvidenceIds.length > 0) {
    channels.add("alibi_contradiction");
    culpritDirectlyImplicated = true;
  }

  if (caseTruth.testimony.some((t) => t.personId === caseTruth.culpritId && t.stance === "lie")) {
    channels.add("testimony_lie");
  }

  const accompliceIds = new Set(caseTruth.accompliceIds);
  const accompliceEvidence = caseTruth.evidence.filter(
    (e) => !e.isRedHerring && e.relatedPersonIds.some((id) => accompliceIds.has(id)),
  );
  if (accompliceEvidence.length > 0) channels.add("accomplice_evidence");

  if (caseTruth.tamperingEvents.length > 0) {
    const traceIds = new Set(caseTruth.tamperingEvents.map((t) => t.secondaryTraceEvidenceId));
    if (caseTruth.evidence.some((e) => traceIds.has(e.id))) channels.add("tampering_trace");
  }

  if (caseTruth.staging.staged && caseTruth.staging.tellEvidenceIds.length > 0) {
    const tellIds = new Set(caseTruth.staging.tellEvidenceIds);
    if (caseTruth.evidence.some((e) => tellIds.has(e.id))) channels.add("staging_tell");
  }

  return {
    score: Math.min(1, channels.size / 4),
    independentChannels: [...channels],
    culpritDirectlyImplicated,
  };
}
