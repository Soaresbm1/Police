import type { CrimeMethod } from "../types/case";
import type { EvidenceSourceTag } from "../types/timeline";
import type { LabAnalysisType } from "../types/evidence";

export interface MethodProfile {
  methodType: CrimeMethod;
  weapon: string;
  method: string;
  causeOfDeath: string;
  wounds: string[];
  physicalTags: EvidenceSourceTag[];
  /** Distinct forensic implication per method: what a lab analysis of the
   * body/scene turns up beyond the generic wound list. */
  forensicNotes: string[];
  requiresLabAnalysis: LabAnalysisType | null;
  /** How compatible this method is with premeditation, in [0,1] — used as a
   * weight, not a hard gate (an impulsive poisoning is rare but possible if
   * the poison was already in the house). */
  premeditationAffinity: number;
  /** Which staging narratives a culprit could plausibly attempt with this
   * method (see staging.ts) — a firearm doesn't stage as a fall, but it
   * stages fine as a robbery gone wrong or (self-inflicted) a suicide. */
  compatibleStaging: Array<"burglary" | "suicide" | "accident" | "robbery_gone_wrong">;
}

export const CRIME_METHOD_PROFILES: Record<CrimeMethod, MethodProfile> = {
  blunt_force: {
    methodType: "blunt_force",
    weapon: "objet contondant",
    method: "Coup porté à l'aide d'un objet contondant trouvé sur les lieux.",
    causeOfDeath: "traumatisme crânien",
    wounds: ["fracture du crâne", "hématome pariétal"],
    physicalTags: ["fingerprint", "blood"],
    forensicNotes: ["angle d'impact unique compatible avec un coup porté de face", "fracture en étoile typique d'un choc localisé"],
    requiresLabAnalysis: "fingerprint",
    premeditationAffinity: 0.25,
    compatibleStaging: ["accident", "burglary", "robbery_gone_wrong"],
  },
  stabbing: {
    methodType: "stabbing",
    weapon: "couteau",
    method: "Coup porté avec une arme blanche.",
    causeOfDeath: "hémorragie interne suite à une plaie par arme blanche",
    wounds: ["plaie perforante au thorax", "coupures de défense sur les avant-bras"],
    physicalTags: ["blood", "fingerprint", "dna"],
    forensicNotes: ["trajectoire de plaie descendante", "profondeur constante sur plusieurs coups"],
    requiresLabAnalysis: "dna",
    premeditationAffinity: 0.4,
    compatibleStaging: ["robbery_gone_wrong", "burglary"],
  },
  poisoning: {
    methodType: "poisoning",
    weapon: "substance toxique",
    method: "Décès par empoisonnement, substance administrée dans un aliment ou une boisson.",
    causeOfDeath: "défaillance organique aiguë d'origine toxique",
    wounds: [],
    physicalTags: ["dna"],
    forensicNotes: [
      "concentration toxique incompatible avec une exposition accidentelle",
      "absence de lésion externe malgré le décès",
    ],
    requiresLabAnalysis: "toxicology",
    premeditationAffinity: 0.9,
    compatibleStaging: ["accident", "suicide"],
  },
  strangulation: {
    methodType: "strangulation",
    weapon: "corde",
    method: "Décès par strangulation.",
    causeOfDeath: "asphyxie par strangulation",
    wounds: ["ecchymoses au cou", "pétéchies conjonctivales"],
    physicalTags: ["dna", "fiber"],
    forensicNotes: ["sillon cervical net", "hémorragies pétéchiales caractéristiques d'une asphyxie"],
    requiresLabAnalysis: "dna",
    premeditationAffinity: 0.5,
    compatibleStaging: ["suicide", "accident"],
  },
  firearm: {
    methodType: "firearm",
    weapon: "arme à feu",
    method: "Décès par arme à feu, tir à courte distance.",
    causeOfDeath: "hémorragie massive suite à une blessure par balle",
    wounds: ["orifice d'entrée thoracique", "résidus de tir à proximité de la plaie"],
    physicalTags: ["blood"],
    forensicNotes: ["résidus de tir (GSR) sur la victime", "trajectoire du projectile incompatible avec un tir à distance"],
    requiresLabAnalysis: "ballistics",
    premeditationAffinity: 0.7,
    compatibleStaging: ["suicide", "robbery_gone_wrong"],
  },
  fall_push: {
    methodType: "fall_push",
    weapon: "chute provoquée",
    method: "Décès consécutif à une chute provoquée depuis une hauteur.",
    causeOfDeath: "polytraumatisme suite à une chute",
    wounds: ["fractures multiples", "traumatisme crânien par impact au sol"],
    physicalTags: ["fiber"],
    forensicNotes: [
      "répartition des fractures incompatible avec une chute libre non assistée",
      "absence de réflexe de protection (pas de fracture du poignet typique d'une chute accidentelle)",
    ],
    requiresLabAnalysis: null,
    premeditationAffinity: 0.2,
    compatibleStaging: ["accident"],
  },
  staged_overdose: {
    methodType: "staged_overdose",
    weapon: "surdose provoquée",
    method: "Décès par surdose, présentée comme accidentelle ou volontaire mais provoquée par un tiers.",
    causeOfDeath: "intoxication médicamenteuse aiguë",
    wounds: [],
    physicalTags: ["dna"],
    forensicNotes: [
      "dosage largement supérieur aux habitudes de consommation connues de la victime",
      "absence de préparation personnelle (pas d'ustensile portant les empreintes de la victime)",
    ],
    requiresLabAnalysis: "toxicology",
    premeditationAffinity: 0.85,
    compatibleStaging: ["suicide", "accident"],
  },
};

export function methodProfilesCompatibleWith(staging: "none" | "burglary" | "suicide" | "accident" | "robbery_gone_wrong"): MethodProfile[] {
  if (staging === "none") return Object.values(CRIME_METHOD_PROFILES);
  return Object.values(CRIME_METHOD_PROFILES).filter((m) => m.compatibleStaging.includes(staging));
}
