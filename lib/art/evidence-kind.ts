import type { EvidenceType } from "@/lib/game-engine/types/evidence";

/**
 * Groups the 24 `EvidenceType`s into 8 visually distinct presentation
 * kinds — enough for evidence to stop reading as one generic card
 * (req. 8) without hand-building two dozen bespoke templates.
 */
export type EvidenceRendererKind =
  | "weapon"
  | "forensic_physical"
  | "digital_communication"
  | "digital_technical"
  | "geolocation"
  | "camera_footage"
  | "financial"
  | "witness_statement"
  | "tampering";

const KIND_BY_TYPE: Record<EvidenceType, EvidenceRendererKind> = {
  weapon: "weapon",
  fingerprint: "forensic_physical",
  dna: "forensic_physical",
  blood: "forensic_physical",
  fiber: "forensic_physical",
  shoeprint: "forensic_physical",
  tire_track: "forensic_physical",
  wound_pattern: "forensic_physical",
  victim_phone: "digital_technical",
  sms_log: "digital_communication",
  call_log: "digital_communication",
  browser_history: "digital_technical",
  wifi_connection_log: "digital_technical",
  deleted_file: "digital_technical",
  photo_metadata: "digital_technical",
  geolocation_log: "geolocation",
  camera_footage: "camera_footage",
  dashcam_footage: "camera_footage",
  card_payment: "financial",
  cash_withdrawal: "financial",
  bank_transfer: "financial",
  debt_record: "financial",
  witness_statement: "witness_statement",
  tampering_trace: "tampering",
  staging_tell: "tampering",
};

export function rendererKindForEvidence(type: EvidenceType): EvidenceRendererKind {
  return KIND_BY_TYPE[type];
}
