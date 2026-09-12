import type { CaseTruth, MotiveType } from "@/lib/game-engine/types/case";
import type { GameSession, Accusation, HintLevel } from "./types";
import { getVisibleEvidence } from "./player-view";

export type Grade = "D" | "C" | "B" | "A" | "S";

export interface CaseScore {
  culpritCorrect: boolean;
  motiveCorrect: boolean;
  methodCorrect: boolean;
  importantEvidenceFound: number;
  importantEvidenceTotal: number;
  chronologyCoveragePercent: number;
  interrogationsCount: number;
  mandatesRequested: number;
  mandatesGranted: number;
  mandatesWasted: number;
  gameTimeSpentMinutes: number;
  /** How many real accomplices the player correctly named. */
  accompliceIdentified: number;
  accompliceTotal: number;
  /** Of the correctly-named accomplices, how many also had the right role. */
  accompliceRoleCorrect: number;
  /** Suspects accused as an accomplice who weren't actually one — a
   * meaningful penalty, scored independently of missing a real accomplice. */
  accompliceWronglyAccused: number;
  /** Phase 2 (investigation guidance) — total points already subtracted
   * from `overallPercent` for hint usage, purely for transparency on the
   * results screen. `0` for a session that never used a hint, including
   * every session persisted before `hintState` existed (see
   * `computeHintPenalty`). Never affects `culpritCorrect`/grade eligibility
   * beyond this one point deduction. */
  hintPenaltyApplied: number;
  grade: Grade;
  overallPercent: number;
}

/** Flat point cost per hint opportunity, keyed by the HIGHEST level ever
 * reached for that opportunity — never cumulative per escalation click
 * (reaching Level 3 costs -2 total, not -1 then another -2). Chosen
 * relative to `scoreAccusation`'s existing 0-100 scale (baseline 40 for
 * the culprit alone, motive +15, method +10, evidence up to +20): small
 * enough that a player who needed real help to finish is never pushed
 * into a worse letter grade than one band down, never a harsh punishment
 * for using an explicitly-offered feature. */
const HINT_PENALTY_BY_LEVEL: Record<HintLevel, number> = { 0: 0, 1: 0, 2: -1, 3: -2 };

/** Sums the per-opportunity penalty across every hint the player ever
 * escalated to at least Level 2 — Level 1 (pure orientation) is always
 * free. Defensive against a session persisted before `hintState` existed
 * (see `types.ts#HintState`'s persistence remark): treats a missing/empty
 * state as zero opportunities used, zero penalty. */
export function computeHintPenalty(session: GameSession): number {
  const progress = session.hintState?.progress ?? {};
  return Object.values(progress).reduce((sum: number, level) => sum + HINT_PENALTY_BY_LEVEL[level], 0);
}

const CRIME_WINDOW_BEFORE = 180;
const CRIME_WINDOW_AFTER = 60;
const EVIDENCE_TIME_TOLERANCE = 20;

/** Exported for reuse by the investigation-guidance hint engine
 * (`hints.ts`) — a gap here is exactly the safe, already-computed
 * "unresolved timeline" signal a `timeline` hint opportunity needs,
 * with no new state or truth-safety concern. */
export function computeChronologyCoverage(truth: CaseTruth, session: GameSession): number {
  const windowStart = truth.crimeTimestamp - CRIME_WINDOW_BEFORE;
  const windowEnd = truth.crimeTimestamp + CRIME_WINDOW_AFTER;
  const relevantEvents = truth.timeline.filter((e) => e.timestamp >= windowStart && e.timestamp <= windowEnd);
  if (relevantEvents.length === 0) return 100;

  const visibleEvidence = getVisibleEvidence(truth, session);
  const covered = relevantEvents.filter((event) =>
    visibleEvidence.some((ev) => Math.abs(ev.timestamp - event.timestamp) <= EVIDENCE_TIME_TOLERANCE),
  );
  return Math.round((covered.length / relevantEvents.length) * 100);
}

export function scoreAccusation(truth: CaseTruth, session: GameSession, accusation: Accusation): CaseScore {
  const culpritCorrect = accusation.culpritId === truth.culpritId;
  const motiveCorrect = culpritCorrect && (accusation.motiveType as MotiveType) === truth.motive.type;
  const methodCorrect = culpritCorrect && accusation.method === truth.weapon;

  const importantEvidence = truth.evidence.filter((ev) => !ev.isRedHerring && ev.relatedPersonIds.includes(truth.culpritId));
  const visible = getVisibleEvidence(truth, session);
  const importantEvidenceFound = importantEvidence.filter((ev) =>
    visible.some((v) => v.id === ev.id),
  ).length;

  // Audited exception (Living Investigation System hardening pass): this
  // reads MandateRecord.granted directly, which is normally forbidden
  // (see types.ts#MandateRecord, enforced by eslint.config.mjs). Safe
  // here specifically because scoreAccusation only ever runs once the
  // player has already submitted their final accusation — the case is
  // over and the truth-reveal screen is about to show CaseTruth itself,
  // so there is nothing left to leak. Never call this mid-investigation.
  const mandateRecords = Object.values(session.mandates);
  const mandatesGranted = mandateRecords.filter((m) => m.granted).length;
  const mandatesWasted = mandateRecords.filter((m) => {
    if (!m.granted) return false;
    const personId = m.key.slice(m.key.indexOf(":") + 1);
    return personId !== truth.culpritId;
  }).length;

  const interrogationsCount = Object.values(session.interrogated).reduce((sum, list) => sum + list.length, 0);

  // Accomplices are scored as a bonus/penalty layer on top of the culprit
  // baseline, never as a pass/fail of their own: naming the right culprit
  // is never turned into a failure just because an accomplice was missed
  // (see the D-grade rule below, which depends only on `culpritCorrect`).
  const trueAccompliceById = new Map(truth.accomplices.map((a) => [a.personId, a]));
  const accusedAccomplices = accusation.accomplices ?? [];
  const correctlyNamed = accusedAccomplices.filter((a) => trueAccompliceById.has(a.personId));
  const accompliceIdentified = correctlyNamed.length;
  const accompliceRoleCorrect = correctlyNamed.filter((a) => trueAccompliceById.get(a.personId)?.role === a.role).length;
  const accompliceWronglyAccused = accusedAccomplices.length - correctlyNamed.length;

  let overallPercent = 0;
  let hintPenaltyApplied = 0;
  if (culpritCorrect) {
    const evidenceRatio = importantEvidence.length > 0 ? importantEvidenceFound / importantEvidence.length : 1;
    const accompliceTotal = truth.accomplices.length;
    const identifyBonus = accompliceTotal > 0 ? (accompliceIdentified / accompliceTotal) * 10 : 0;
    const roleBonus = accompliceTotal > 0 ? (accompliceRoleCorrect / accompliceTotal) * 5 : 0;
    const falseAccusationPenalty = accompliceWronglyAccused * 8;
    // Investigation-guidance penalty (Phase 2) — only applied to an
    // otherwise-successful accusation; a wrong culprit already scores the
    // flat 5 below and is never pushed lower for having used a hint.
    hintPenaltyApplied = computeHintPenalty(session);
    overallPercent =
      40 + // baseline for correctly naming the culprit
      (motiveCorrect ? 15 : 0) +
      (methodCorrect ? 10 : 0) +
      evidenceRatio * 20 +
      Math.min(10, interrogationsCount) +
      identifyBonus +
      roleBonus -
      falseAccusationPenalty +
      hintPenaltyApplied;
  } else {
    overallPercent = 5;
  }
  overallPercent = Math.max(0, Math.min(100, Math.round(overallPercent)));

  const grade: Grade = !culpritCorrect
    ? "D"
    : overallPercent >= 90
      ? "S"
      : overallPercent >= 75
        ? "A"
        : overallPercent >= 55
          ? "B"
          : "C";

  return {
    culpritCorrect,
    motiveCorrect,
    methodCorrect,
    importantEvidenceFound,
    importantEvidenceTotal: importantEvidence.length,
    chronologyCoveragePercent: computeChronologyCoverage(truth, session),
    interrogationsCount,
    mandatesRequested: mandateRecords.length,
    mandatesGranted,
    mandatesWasted,
    gameTimeSpentMinutes: accusation.submittedAt - truth.crimeTimestamp,
    accompliceIdentified,
    accompliceTotal: truth.accomplices.length,
    accompliceRoleCorrect,
    accompliceWronglyAccused,
    hintPenaltyApplied,
    grade,
    overallPercent,
  };
}
