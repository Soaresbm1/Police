// Static name/flavor pools for a small fictional Swiss-Romande town.
// Kept separate from generation logic so they're easy to extend later.

export const TOWN_NAME = "Vironval";

export const MALE_FIRST_NAMES = [
  "Marc",
  "Julien",
  "Nicolas",
  "Thomas",
  "Antoine",
  "Pierre",
  "Louis",
  "Mathieu",
  "David",
  "Sébastien",
  "Olivier",
  "Frédéric",
  "Yann",
  "Bastien",
  "Cédric",
  "Laurent",
  "Vincent",
  "Hugo",
  "Simon",
  "Damien",
];

export const FEMALE_FIRST_NAMES = [
  "Julie",
  "Claire",
  "Sophie",
  "Camille",
  "Laura",
  "Nathalie",
  "Émilie",
  "Aline",
  "Sarah",
  "Chloé",
  "Manon",
  "Céline",
  "Isabelle",
  "Valérie",
  "Marion",
  "Élodie",
  "Sandra",
  "Léa",
  "Delphine",
  "Anaïs",
];

export const LAST_NAMES = [
  "Dupont",
  "Moreau",
  "Bertrand",
  "Rochat",
  "Favre",
  "Perrin",
  "Girard",
  "Blanc",
  "Vuille",
  "Berger",
  "Charrière",
  "Meylan",
  "Jaquet",
  "Progin",
  "Rossier",
  "Chappuis",
  "Dumont",
  "Fontana",
  "Marchand",
  "Golay",
  "Studer",
  "Weber",
  "Keller",
  "Brunner",
];

// Occupation list (and the age/life-status rules governing who can hold
// which one) now lives in `case-generator/occupations.ts` — this used to be
// a flat list here, but occupation selection needs per-occupation metadata
// (minAge, allowedStatuses, ...), not just names.

export const STREET_NAMES = [
  "rue du Lac",
  "avenue des Alpes",
  "chemin des Vignes",
  "rue de la Gare",
  "rue du Marché",
  "avenue de la Paix",
  "rue des Écoles",
  "chemin du Moulin",
  "rue Centrale",
  "avenue du Stand",
  "rue des Fontaines",
  "chemin des Pins",
];

export const ADDICTIONS_POOL = ["alcool", "jeu d'argent", "médicaments", "tabac"];

export const CAR_MAKES = ["Renault", "VW", "Skoda", "Toyota", "Peugeot", "Audi", "BMW", "Fiat"];
export const CAR_COLORS = ["noire", "grise", "blanche", "bleu foncé", "rouge", "verte"];

export const WIFI_SSID_PREFIXES = ["Free", "Guest", "Public", "Client"];
