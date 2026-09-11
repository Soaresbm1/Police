import type { CaseTruth } from "@/lib/game-engine/types/case";
import type { Evidence, EvidenceType } from "@/lib/game-engine/types/evidence";
import type { PersonId } from "@/lib/game-engine/types/person";
import type { LocationId } from "@/lib/game-engine/types/location";
import { LAB_ANALYSIS_DURATION_MINUTES } from "@/lib/game-engine/types/evidence";
import type { GameSession } from "./types";
import { resolveEvents, scheduleEvent } from "./events";
import { LAB_ANALYSIS_LABEL } from "./labels";

const DIGITAL_RECORD_TYPES: EvidenceType[] = [
  "sms_log",
  "call_log",
  "browser_history",
  "geolocation_log",
  "wifi_connection_log",
  "deleted_file",
  "photo_metadata",
];

const BANK_RECORD_TYPES: EvidenceType[] = ["card_payment", "cash_withdrawal", "bank_transfer", "debt_record"];

function statusOf(session: GameSession, evidenceId: string): string {
  return session.evidenceStatus[evidenceId] ?? "undiscovered";
}

function reveal(session: GameSession, matches: Evidence[]): string[] {
  const revealed: string[] = [];
  for (const ev of matches) {
    if (statusOf(session, ev.id) === "undiscovered") {
      session.evidenceStatus[ev.id] = "discovered";
      revealed.push(ev.id);
    }
  }
  return revealed;
}

export interface DiscoveryResult {
  revealedEvidenceIds: string[];
  message: string;
}

/** The set of crime-scene evidence obvious enough to find without a lab or
 * a targeted records request — shared by the bulk `examineCrimeScene` action
 * and the spatial crime-scene screen's per-hotspot inspection, so both
 * present exactly the same underlying discoverable set. */
export function getCrimeSceneEvidence(truth: CaseTruth): Evidence[] {
  return truth.evidence.filter(
    (ev) =>
      !ev.isRedHerring &&
      ev.relatedLocationIds.includes(truth.crimeLocationId) &&
      (ev.family === "physical" || ev.family === "video") &&
      ev.discoveryDifficulty <= 0.5,
  );
}

/** Processes the crime scene itself: obvious physical/video evidence at the
 * crime location surfaces immediately; anything with high discovery
 * difficulty still needs a targeted request (lab, records, search). */
export function examineCrimeScene(truth: CaseTruth, session: GameSession): DiscoveryResult {
  session.crimeSceneExamined = true;
  const revealedEvidenceIds = reveal(session, getCrimeSceneEvidence(truth));
  return {
    revealedEvidenceIds,
    message:
      revealedEvidenceIds.length > 0
        ? `Examen de la scène de crime : ${revealedEvidenceIds.length} élément(s) relevé(s).`
        : "Examen de la scène de crime : rien d'évident à première vue.",
  };
}

/** Reveals a single crime-scene evidence item — used when the player
 * inspects one specific hotspot on the spatial scene screen rather than
 * examining the whole scene in bulk. Silently ignores ids outside the
 * legitimate crime-scene set so a tampered client request can't reveal
 * arbitrary evidence. */
export function inspectCrimeSceneHotspot(truth: CaseTruth, session: GameSession, evidenceId: string): DiscoveryResult {
  session.crimeSceneExamined = true;
  const target = getCrimeSceneEvidence(truth).find((ev) => ev.id === evidenceId);
  const revealedEvidenceIds = target ? reveal(session, [target]) : [];
  return {
    revealedEvidenceIds,
    message: revealedEvidenceIds.length > 0 ? "Élément relevé et enregistré au dossier." : "Rien de plus à relever ici.",
  };
}

export function checkDigitalRecords(truth: CaseTruth, session: GameSession, personId: PersonId): DiscoveryResult {
  const matches = truth.evidence.filter((ev) => ev.relatedPersonIds.includes(personId) && DIGITAL_RECORD_TYPES.includes(ev.type));
  const revealedEvidenceIds = reveal(session, matches);
  return {
    revealedEvidenceIds,
    message:
      revealedEvidenceIds.length > 0
        ? `Dossier numérique : ${revealedEvidenceIds.length} élément(s) trouvé(s).`
        : "Dossier numérique : aucun élément exploitable.",
  };
}

export function checkBankRecords(truth: CaseTruth, session: GameSession, personId: PersonId): DiscoveryResult {
  const matches = truth.evidence.filter((ev) => ev.relatedPersonIds.includes(personId) && BANK_RECORD_TYPES.includes(ev.type));
  const revealedEvidenceIds = reveal(session, matches);
  return {
    revealedEvidenceIds,
    message:
      revealedEvidenceIds.length > 0
        ? `Relevés bancaires : ${revealedEvidenceIds.length} élément(s) trouvé(s).`
        : "Relevés bancaires : aucune opération notable.",
  };
}

export function checkCameraFootage(truth: CaseTruth, session: GameSession, locationId: LocationId): DiscoveryResult {
  const matches = truth.evidence.filter((ev) => ev.type === "camera_footage" && ev.relatedLocationIds.includes(locationId));
  const revealedEvidenceIds = reveal(session, matches);
  return {
    revealedEvidenceIds,
    message:
      revealedEvidenceIds.length > 0
        ? `Vidéosurveillance : ${revealedEvidenceIds.length} séquence(s) trouvée(s).`
        : "Vidéosurveillance : rien d'exploitable pour ce lieu.",
  };
}

export function searchLocation(truth: CaseTruth, session: GameSession, locationId: LocationId): DiscoveryResult {
  const matches = truth.evidence.filter((ev) => ev.family === "physical" && ev.relatedLocationIds.includes(locationId));
  const revealedEvidenceIds = reveal(session, matches);
  return {
    revealedEvidenceIds,
    message:
      revealedEvidenceIds.length > 0
        ? `Perquisition : ${revealedEvidenceIds.length} élément(s) relevé(s).`
        : "Perquisition : rien de probant trouvé sur place.",
  };
}

/** Interrogating someone surfaces any red-herring witness-statement
 * evidence tied to them (a rumor/sighting reported about that person). */
export function revealFromInterrogation(truth: CaseTruth, session: GameSession, personId: PersonId): string[] {
  const matches = truth.evidence.filter((ev) => ev.type === "witness_statement" && ev.relatedPersonIds.includes(personId));
  return reveal(session, matches);
}

export function collectEvidence(session: GameSession, evidenceId: string): void {
  if (statusOf(session, evidenceId) === "discovered") {
    session.evidenceStatus[evidenceId] = "collected";
  }
}

export function sendToLab(truth: CaseTruth, session: GameSession, evidenceId: string): { ok: boolean; message: string } {
  const evidence = truth.evidence.find((e) => e.id === evidenceId);
  if (!evidence) return { ok: false, message: "Preuve introuvable." };
  if (!evidence.requiresLabAnalysis) return { ok: false, message: "Cette preuve ne nécessite pas d'analyse." };
  const status = statusOf(session, evidenceId);
  if (status === "undiscovered") return { ok: false, message: "Cette preuve n'a pas encore été découverte." };
  if (status === "sent_to_lab" || status === "analyzed") return { ok: false, message: "Déjà envoyée au laboratoire." };

  const duration = LAB_ANALYSIS_DURATION_MINUTES[evidence.requiresLabAnalysis];
  session.evidenceStatus[evidenceId] = "sent_to_lab";
  session.labQueue.push({
    evidenceId,
    analysisType: evidence.requiresLabAnalysis,
    submittedAt: session.currentTime,
    readyAt: session.currentTime + duration,
  });
  // The event is purely the notification/inbox representation — LabJob
  // above remains the sole authoritative record of the actual result
  // (see advanceTime below); scheduledAt is set to match LabJob.readyAt
  // exactly so the two never drift apart. The payload never mentions the
  // result itself, only that an analysis was requested/will complete.
  scheduleEvent(session, "lab_result", { kind: "evidence", id: evidenceId }, duration, {
    title: "LABORATOIRE — Analyse terminée",
    detail: `${LAB_ANALYSIS_LABEL[evidence.requiresLabAnalysis]} — rapport disponible.`,
  });
  return { ok: true, message: `${LAB_ANALYSIS_LABEL[evidence.requiresLabAnalysis]} demandée — résultat dans ${duration} min de jeu.` };
}

/** Advances the game clock, completes any lab jobs whose time has come
 * (unchanged, existing logic — LabJob stays authoritative for the actual
 * result), then resolves the central investigation-event schedule. Both
 * steps key off the same `currentTime`, so a lab result and its mirror
 * notification event always become available in the same clock tick. */
export function advanceTime(session: GameSession, minutes: number): { completedEvidenceIds: string[] } {
  session.currentTime += minutes;
  const completed: string[] = [];
  for (const job of session.labQueue) {
    const status = statusOf(session, job.evidenceId);
    if (status === "sent_to_lab" && session.currentTime >= job.readyAt) {
      session.evidenceStatus[job.evidenceId] = "analyzed";
      completed.push(job.evidenceId);
    }
  }
  resolveEvents(session);
  return { completedEvidenceIds: completed };
}
