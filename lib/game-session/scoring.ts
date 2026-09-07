import type { CaseTruth, MotiveType } from "@/lib/game-engine/types/case";
import type { GameSession, Accusation } from "./types";
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
  grade: Grade;
  overallPercent: number;
}

const CRIME_WINDOW_BEFORE = 180;
const CRIME_WINDOW_AFTER = 60;
const EVIDENCE_TIME_TOLERANCE = 20;

function computeChronologyCoverage(truth: CaseTruth, session: GameSession): number {
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

  const mandateRecords = Object.values(session.mandates);
  const mandatesGranted = mandateRecords.filter((m) => m.granted).length;
  const mandatesWasted = mandateRecords.filter((m) => {
    if (!m.granted) return false;
    const personId = m.key.slice(m.key.indexOf(":") + 1);
    return personId !== truth.culpritId;
  }).length;

  const interrogationsCount = Object.values(session.interrogated).reduce((sum, list) => sum + list.length, 0);

  let overallPercent = 0;
  if (culpritCorrect) {
    const evidenceRatio = importantEvidence.length > 0 ? importantEvidenceFound / importantEvidence.length : 1;
    overallPercent =
      40 + // baseline for correctly naming the culprit
      (motiveCorrect ? 15 : 0) +
      (methodCorrect ? 10 : 0) +
      evidenceRatio * 25 +
      Math.min(10, interrogationsCount);
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
    grade,
    overallPercent,
  };
}
