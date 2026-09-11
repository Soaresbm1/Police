import type { CaseTruth } from "@/lib/game-engine/types/case";
import type { EvidenceReliability, LabAnalysisType } from "@/lib/game-engine/types/evidence";
import type { GameSession } from "./types";
import { formatGameTime } from "@/lib/game-engine/types/time";
import { evidenceCode as computeEvidenceCode, labReportCode } from "@/lib/art/evidence-code";
import { LAB_ANALYSIS_LABEL, RECORD_TYPE_LABEL, RELIABILITY_LABEL } from "./labels";
import { evidenceStatusOf } from "./player-view";
import { findEvent } from "./events";

/**
 * Player-facing verdict line, keyed by reliability only — reliability is
 * already the engine's one real "how much can you trust this" signal, so
 * this never invents a second, richer axis (e.g. a suspect-sample
 * "match") the engine doesn't actually model.
 */
const RESULT_LABEL: Record<EvidenceReliability, string> = {
  reliable: "Analyse concluante",
  partial: "Analyse partiellement concluante",
  ambiguous: "Résultat ambigu",
  contaminated: "Échantillon compromis",
  falsified: "Résultat invalidé — indices de falsification",
};

/**
 * A short, forensic-register interpretation sentence per analysis type,
 * qualified by reliability. Deliberately never mentions a suspect, a
 * match, or any comparison — the engine has no such mechanism (see
 * `EvidenceCard.tsx`'s "do not invent a match" constraint), so the report
 * only ever describes the sample/trace itself.
 */
const INTERPRETATION_BY_TYPE: Record<LabAnalysisType, Record<EvidenceReliability, string>> = {
  dna: {
    reliable: "Profil ADN complet et exploitable, extrait dans de bonnes conditions.",
    partial: "Profil ADN partiel ; suffisamment de marqueurs exploitables pour une interprétation prudente.",
    ambiguous: "Profil ADN mixte ou de faible quantité ; l'interprétation reste incertaine.",
    contaminated: "Échantillon contaminé lors du prélèvement ou du transport ; fiabilité du profil réduite.",
    falsified: "Incohérences relevées dans l'échantillon, compatibles avec une manipulation délibérée.",
  },
  fingerprint: {
    reliable: "Empreinte nette, avec suffisamment de points caractéristiques pour une comparaison fiable.",
    partial: "Empreinte partielle ou légèrement maculée ; comparaison possible mais moins certaine.",
    ambiguous: "Empreinte trop diffuse pour une lecture univoque des points caractéristiques.",
    contaminated: "Support altéré (humidité, produit de nettoyage) ayant dégradé la trace relevée.",
    falsified: "Trace présentant des caractéristiques incompatibles avec un dépôt naturel.",
  },
  toxicology: {
    reliable: "Dosage réalisé sur échantillon en bon état ; résultats directement exploitables.",
    partial: "Dosage réalisé sur quantité limitée ; résultats exploitables avec une marge d'incertitude.",
    ambiguous: "Dégradation partielle de l'échantillon ; certains résultats restent incertains.",
    contaminated: "Échantillon dégradé ou mal conservé ; fiabilité du dosage réduite.",
    falsified: "Composition incompatible avec un prélèvement non altéré.",
  },
  ballistics: {
    reliable: "Éléments balistiques en bon état, analyse directement exploitable.",
    partial: "Éléments partiellement endommagés ; analyse possible avec réserve.",
    ambiguous: "Déformation importante des éléments rendant l'analyse incertaine.",
    contaminated: "Éléments manipulés ou conservés dans de mauvaises conditions.",
    falsified: "Caractéristiques incompatibles avec les conditions rapportées.",
  },
  digital_forensics: {
    reliable: "Données extraites intactes ; horodatages et métadonnées cohérents.",
    partial: "Données partiellement récupérées ; certains éléments restent incomplets.",
    ambiguous: "Métadonnées incomplètes ou incohérentes, limitant l'interprétation.",
    contaminated: "Support numérique altéré après les faits, avant le prélèvement.",
    falsified: "Traces d'altération des métadonnées relevées sur le support.",
  },
};

export interface LabReportView {
  reportId: string;
  evidenceCode: string;
  evidenceTypeLabel: string;
  analysisTypeLabel: string;
  origin: string;
  submittedAtLabel: string;
  completedAtLabel: string;
  reliabilityLabel: string;
  resultLabel: string;
  interpretation: string;
}

/**
 * Strictly gated to `playerStatus === "analyzed"` — the same guard the UI
 * uses to decide whether to even show a "Consulter" button, enforced again
 * here so no caller can request a report before the lab actually finished.
 * Returns `null` for anything else (not lab-eligible, not yet analyzed, or
 * an unknown id), never a partial/placeholder report.
 */
export function getLabReport(truth: CaseTruth, session: GameSession, evidenceId: string): LabReportView | null {
  const evidence = truth.evidence.find((e) => e.id === evidenceId);
  if (!evidence || !evidence.requiresLabAnalysis) return null;
  if (evidenceStatusOf(session, evidenceId) !== "analyzed") return null;

  const job = session.labQueue.find((j) => j.evidenceId === evidenceId);
  if (!job) return null;

  const analysisType = evidence.requiresLabAnalysis;
  const locationId = evidence.relatedLocationIds[0];
  const location = locationId ? truth.locations.find((l) => l.id === locationId) : undefined;

  return {
    reportId: labReportCode(evidenceId, 2026),
    evidenceCode: computeEvidenceCode(evidenceId),
    evidenceTypeLabel: RECORD_TYPE_LABEL[evidence.type],
    analysisTypeLabel: LAB_ANALYSIS_LABEL[analysisType],
    origin: location?.name ?? "Lieu non précisé",
    submittedAtLabel: formatGameTime(job.submittedAt),
    completedAtLabel: formatGameTime(job.readyAt),
    reliabilityLabel: RELIABILITY_LABEL[evidence.reliability],
    resultLabel: RESULT_LABEL[evidence.reliability],
    interpretation: INTERPRETATION_BY_TYPE[analysisType][evidence.reliability],
  };
}

/** The `lab_result` InvestigationEvent id for a given evidence, if one was
 * ever scheduled — used to mark the report "consulted" (ready → seen) the
 * first time the player actually opens it. */
export function labResultEventId(session: GameSession, evidenceId: string): string | undefined {
  return findEvent(session, "lab_result", { kind: "evidence", id: evidenceId })?.id;
}
