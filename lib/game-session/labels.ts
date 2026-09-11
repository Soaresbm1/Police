import type { AccompliceRole, CaseArchetype, MotiveType } from "@/lib/game-engine/types/case";
import type { EvidenceReliability, EvidenceType, FinancialTransactionDirection, LabAnalysisType } from "@/lib/game-engine/types/evidence";

export const RECORD_TYPE_LABEL: Record<EvidenceType, string> = {
  fingerprint: "Empreinte",
  dna: "ADN",
  blood: "Sang",
  fiber: "Fibre",
  shoeprint: "Empreinte de chaussure",
  tire_track: "Trace de pneu",
  weapon: "Arme",
  wound_pattern: "Blessure",
  sms_log: "SMS",
  call_log: "Appel",
  browser_history: "Historique web",
  geolocation_log: "Géolocalisation",
  wifi_connection_log: "Connexion Wi-Fi",
  deleted_file: "Fichier supprimé",
  photo_metadata: "Métadonnées photo",
  victim_phone: "Téléphone portable",
  camera_footage: "Vidéosurveillance",
  dashcam_footage: "Dashcam",
  card_payment: "Paiement carte",
  cash_withdrawal: "Retrait",
  bank_transfer: "Virement",
  debt_record: "Dette enregistrée",
  witness_statement: "Témoignage",
  tampering_trace: "Trace de manipulation",
  staging_tell: "Incohérence de mise en scène",
};

/**
 * Single source of truth for how a lab analysis type reads to the player
 * — previously duplicated three ways (discovery.ts's lowercase notification
 * text, laboratoire/page.tsx's capitalized label, and two raw-string
 * `evidence.requiresLabAnalysis` prints in EvidenceCard.tsx/
 * EvidenceInspectionModal.tsx that showed the untranslated English type
 * value, e.g. "Envoyer au laboratoire (fingerprint)") — this is what
 * player feedback flagged as "DNA is clear, fingerprint handling is
 * unclear": the fingerprint workflow already existed, only its label
 * didn't read as French.
 */
export const LAB_ANALYSIS_LABEL: Record<LabAnalysisType, string> = {
  dna: "Analyse ADN",
  fingerprint: "Analyse d'empreintes digitales",
  toxicology: "Analyse toxicologique",
  ballistics: "Analyse balistique",
  digital_forensics: "Analyse forensique numérique",
};

export const FINANCIAL_DIRECTION_LABEL: Record<FinancialTransactionDirection, string> = {
  debit: "Débit",
  credit: "Crédit",
};

/** Centralized so EvidenceCard.tsx and EvidenceInspectionModal.tsx can
 * never drift (previously only the modal translated this — the card
 * showed the raw English enum value). */
export const RELIABILITY_LABEL: Record<EvidenceReliability, string> = {
  reliable: "Fiable",
  partial: "Partielle",
  ambiguous: "Ambiguë",
  contaminated: "Contaminée",
  falsified: "Falsifiée",
};

export const MOTIVE_LABEL: Record<MotiveType, string> = {
  jealousy: "Jalousie",
  revenge: "Vengeance",
  money: "Argent",
  inheritance: "Héritage",
  debt: "Dette",
  blackmail: "Chantage",
  secret_exposure: "Peur qu'un secret soit révélé",
  crime_passionnel: "Crime passionnel",
  professional_conflict: "Conflit professionnel",
  fraud: "Fraude",
  fear_of_denunciation: "Peur d'être dénoncé·e",
  rivalry: "Rivalité",
  protect_a_loved_one: "Protection d'un proche",
  staged_accident: "Accident maquillé",
};

export const ARCHETYPE_LABEL: Record<CaseArchetype, string> = {
  domestic_conflict: "Conflit domestique",
  workplace_conspiracy: "Conspiration professionnelle",
  inheritance_dispute: "Différend successoral",
  financial_fraud_murder: "Fraude financière ayant dégénéré",
  disappearance_to_homicide: "Disparition devenue homicide",
  staged_burglary: "Cambriolage maquillé",
  revenge_killing: "Règlement de comptes",
  crime_of_opportunity: "Crime d'opportunité",
};

export const ACCOMPLICE_ROLE_LABEL: Record<AccompliceRole, string> = {
  planner: "organisateur·rice",
  lookout: "guetteur·se",
  driver: "chauffeur·se",
  evidence_disposal: "chargé·e de faire disparaître des preuves",
  false_alibi_provider: "fournisseur·se de faux alibi",
};

export const WEAPON_OPTIONS = [
  "couteau de cuisine",
  "objet contondant",
  "strangulation",
  "couteau",
  "arme à feu",
  "corde",
  "substance toxique",
  "chute provoquée",
  "surdose provoquée",
];
