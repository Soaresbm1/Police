import type { MotiveType } from "@/lib/game-engine/types/case";
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

export const WEAPON_OPTIONS = ["couteau de cuisine", "objet contondant", "strangulation", "couteau", "arme à feu", "corde"];
