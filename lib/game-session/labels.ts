import type { MotiveType } from "@/lib/game-engine/types/case";

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
