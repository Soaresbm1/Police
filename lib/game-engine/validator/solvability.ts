import type { CaseTruth } from "../types/case";

export type SolvabilityChannel = "motive" | "physical" | "video" | "digital" | "financial" | "alibi_contradiction" | "testimony_lie";

export interface SolvabilityResult {
  score: number;
  independentChannels: SolvabilityChannel[];
}

export const MIN_INDEPENDENT_CHANNELS = 3;

/**
 * Counts independent "channels" of proof against the true culprit. The rule
 * from the design spec is simple but important: the solution must never rest
 * on a single fragile clue (e.g. one fingerprint). We require several
 * structurally different kinds of evidence to converge — mirroring how a
 * real investigation builds a case (motive + presence + physical evidence,
 * or a broken alibi + geolocation + a financial trail).
 */
export function computeSolvability(caseTruth: CaseTruth): SolvabilityResult {
  const channels = new Set<SolvabilityChannel>();

  if (caseTruth.motive.strength > 0.2) channels.add("motive");

  const incriminating = caseTruth.evidence.filter(
    (e) => !e.isRedHerring && e.relatedPersonIds.includes(caseTruth.culpritId),
  );
  for (const evidence of incriminating) {
    if (evidence.family === "physical") channels.add("physical");
    if (evidence.family === "video") channels.add("video");
    if (evidence.family === "digital") channels.add("digital");
    if (evidence.family === "financial") channels.add("financial");
  }

  const culpritAlibi = caseTruth.alibis.find((a) => a.personId === caseTruth.culpritId);
  if (culpritAlibi && !culpritAlibi.isTrue && culpritAlibi.contradictingEvidenceIds.length > 0) {
    channels.add("alibi_contradiction");
  }

  if (caseTruth.testimony.some((t) => t.personId === caseTruth.culpritId && t.stance === "lie")) {
    channels.add("testimony_lie");
  }

  return {
    score: Math.min(1, channels.size / 4),
    independentChannels: [...channels],
  };
}
