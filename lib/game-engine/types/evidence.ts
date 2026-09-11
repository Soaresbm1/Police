import type { PersonId } from "./person";
import type { LocationId } from "./location";
import type { GameMinutes } from "./time";

export type TamperingAction =
  | "wipe_fingerprints"
  | "delete_phone_data"
  | "avoid_cctv"
  | "burn_clothing"
  | "move_object"
  | "hide_weapon"
  | "send_fake_message"
  | "clean_scene"
  | "disguise_transaction";

/**
 * A deliberate cover-up act by the culprit (or an evidence_disposal
 * accomplice) — distinct from the passive, random "contaminated" evidence
 * reliability rolled elsewhere. Always has a cost (it takes time, placed on
 * the actor's real timeline), a risk (`riskOfTrace`), and — critically — a
 * `secondaryTraceEvidenceId`: the tampering itself is never risk-free, it
 * always leaves *some* discoverable evidence of having happened, even when
 * it successfully suppresses the evidence it targeted.
 */
export interface TamperingEvent {
  id: string;
  action: TamperingAction;
  actorId: PersonId;
  timestamp: GameMinutes;
  locationId: LocationId;
  costMinutes: number;
  riskOfTrace: number;
  /** Evidence id that would otherwise exist but was suppressed/altered by
   * this act, if any (null for fabrication-only actions like a fake message). */
  targetEvidenceId: string | null;
  /** Always populated: the trace this act leaves behind regardless of
   * whether it succeeded at suppressing the target. */
  secondaryTraceEvidenceId: string;
  description: string;
}

export type EvidenceFamily = "physical" | "digital" | "video" | "financial" | "testimonial";

export type EvidenceType =
  // physical
  | "fingerprint"
  | "dna"
  | "blood"
  | "fiber"
  | "shoeprint"
  | "tire_track"
  | "weapon"
  | "wound_pattern"
  // digital device recovered at the scene (the physical object itself —
  // distinct from the log types below, which are records ABOUT a device)
  | "victim_phone"
  // digital
  | "sms_log"
  | "call_log"
  | "browser_history"
  | "geolocation_log"
  | "wifi_connection_log"
  | "deleted_file"
  | "photo_metadata"
  // video
  | "camera_footage"
  | "dashcam_footage"
  // financial
  | "card_payment"
  | "cash_withdrawal"
  | "bank_transfer"
  | "debt_record"
  // testimonial
  | "witness_statement"
  // tampering / staging traces that don't fit an existing forensic category
  | "tampering_trace"
  | "staging_tell";

export const EVIDENCE_FAMILY_BY_TYPE: Record<EvidenceType, EvidenceFamily> = {
  fingerprint: "physical",
  dna: "physical",
  blood: "physical",
  fiber: "physical",
  shoeprint: "physical",
  tire_track: "physical",
  weapon: "physical",
  wound_pattern: "physical",
  victim_phone: "physical",
  sms_log: "digital",
  call_log: "digital",
  browser_history: "digital",
  geolocation_log: "digital",
  wifi_connection_log: "digital",
  deleted_file: "digital",
  photo_metadata: "digital",
  camera_footage: "video",
  dashcam_footage: "video",
  card_payment: "financial",
  cash_withdrawal: "financial",
  bank_transfer: "financial",
  debt_record: "financial",
  witness_statement: "testimonial",
  tampering_trace: "physical",
  staging_tell: "physical",
};

export type EvidenceReliability = "reliable" | "partial" | "ambiguous" | "contaminated" | "falsified";

export type EvidenceStatus =
  | "undiscovered"
  | "discovered"
  | "collected"
  | "sent_to_lab"
  | "analyzed"
  | "archived";

export type LabAnalysisType = "dna" | "fingerprint" | "toxicology" | "ballistics" | "digital_forensics";

export const LAB_ANALYSIS_DURATION_MINUTES: Record<LabAnalysisType, number> = {
  fingerprint: 20,
  dna: 45,
  ballistics: 60,
  toxicology: 120,
  digital_forensics: 90,
};

export type FinancialTransactionDirection = "debit" | "credit";

/**
 * Player-UX pass (evidence clarity): structured detail for `financial`-
 * family evidence, so the banking app can show a real amount/type/
 * counterparty instead of a bare description line. Optional on `Evidence`
 * — absent for every non-financial type, and never fabricated beyond what
 * the immutable transaction actually represents (no `relevantToCrime`/
 * `suspicious` flag anywhere here or downstream; see
 * `evidence-generator.ts`).
 */
export interface FinancialTransactionDetails {
  amountChf: number;
  direction: FinancialTransactionDirection;
  /** Who/what is on the other side of the transaction — a merchant name
   * for a card payment, a bank/ATM label for a withdrawal, a person's
   * name for a transfer. Always a real, already-legitimate label (a venue
   * or person the evidence is already tied to), never invented beyond
   * that. */
  counterpartyLabel: string;
}

export interface Evidence {
  id: string;
  family: EvidenceFamily;
  type: EvidenceType;
  /** Ground-truth link to the event that produced it. Server-only. */
  sourceEventId: string | null;
  sourceLocationId: LocationId | null;
  relatedPersonIds: PersonId[];
  relatedLocationIds: LocationId[];
  /** When the underlying fact happened. */
  timestamp: GameMinutes;
  /** Earliest in-game time this could be found (>= scene processing start, etc). */
  discoverableAt: GameMinutes;
  /** 0 = obvious/impossible to miss, 1 = requires a specific, non-obvious action to surface. */
  discoveryDifficulty: number;
  reliability: EvidenceReliability;
  requiresLabAnalysis: LabAnalysisType | null;
  isRedHerring: boolean;
  status: EvidenceStatus;
  /** Player-facing factual description (still ground-truth-accurate; narrative flavor is a
   * separate concern handled by the NarrativeProvider layer). */
  description: string;
  /** Only set for `family === "financial"` evidence. See
   * `FinancialTransactionDetails`. */
  financialDetails?: FinancialTransactionDetails;
}
