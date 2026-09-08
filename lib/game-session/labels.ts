import type { AccompliceRole, CaseArchetype, MotiveType } from "@/lib/game-engine/types/case";
import type { EvidenceType } from "@/lib/game-engine/types/evidence";

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
