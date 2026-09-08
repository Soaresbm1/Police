import type { RNG } from "../random/rng";
import type { Person } from "../types/person";
import type { Location } from "../types/location";
import type { GameMinutes } from "../types/time";
import type { EvidenceSourceTag, TimelineEvent } from "../types/timeline";
import type { Evidence, EvidenceReliability, EvidenceType, LabAnalysisType } from "../types/evidence";
import { EVIDENCE_FAMILY_BY_TYPE } from "../types/evidence";

interface TagMapping {
  type: EvidenceType;
  requiresLabAnalysis: LabAnalysisType | null;
  baseReliability: EvidenceReliability;
  describe: (event: TimelineEvent, people: Map<string, Person>, locations: Map<string, Location>) => string;
}

function personName(id: string, people: Map<string, Person>): string {
  const p = people.get(id);
  return p ? `${p.firstName} ${p.lastName}` : "Personne inconnue";
}

function locationName(id: string, locations: Map<string, Location>): string {
  return locations.get(id)?.name ?? "Lieu inconnu";
}

const TAG_MAPPINGS: Partial<Record<EvidenceSourceTag, TagMapping>> = {
  camera: {
    type: "camera_footage",
    requiresLabAnalysis: null,
    baseReliability: "reliable",
    describe: (e, people, locations) =>
      `Vidéosurveillance de ${locationName(e.locationId, locations)} montrant ${personName(e.actorId, people)} vers cette heure.`,
  },
  phone_cell_tower: {
    type: "geolocation_log",
    requiresLabAnalysis: null,
    baseReliability: "partial",
    describe: (e, people, locations) =>
      `Le téléphone de ${personName(e.actorId, people)} borne une antenne proche de ${locationName(e.locationId, locations)}.`,
  },
  phone_wifi: {
    type: "wifi_connection_log",
    requiresLabAnalysis: null,
    baseReliability: "reliable",
    describe: (e, people, locations) =>
      `Le téléphone de ${personName(e.actorId, people)} s'est connecté au réseau Wi-Fi de ${locationName(e.locationId, locations)}.`,
  },
  fingerprint: {
    type: "fingerprint",
    requiresLabAnalysis: "fingerprint",
    baseReliability: "reliable",
    describe: (e, people, locations) =>
      `Empreintes digitales relevées sur ${e.involvedObject ?? "un objet"} à ${locationName(e.locationId, locations)}.`,
  },
  dna: {
    type: "dna",
    requiresLabAnalysis: "dna",
    baseReliability: "reliable",
    describe: (e, people, locations) => `Trace ADN relevée à ${locationName(e.locationId, locations)}.`,
  },
  blood: {
    type: "blood",
    requiresLabAnalysis: "dna",
    baseReliability: "reliable",
    describe: (e, people, locations) => `Traces de sang relevées à ${locationName(e.locationId, locations)}.`,
  },
  fiber: {
    type: "fiber",
    requiresLabAnalysis: null,
    baseReliability: "partial",
    describe: (e, people, locations) => `Fibres textiles relevées à ${locationName(e.locationId, locations)}.`,
  },
  card_payment: {
    type: "card_payment",
    requiresLabAnalysis: null,
    baseReliability: "reliable",
    describe: (e, people, locations) =>
      `Paiement par carte de ${personName(e.actorId, people)} enregistré à ${locationName(e.locationId, locations)}.`,
  },
  cash_withdrawal: {
    type: "cash_withdrawal",
    requiresLabAnalysis: null,
    baseReliability: "reliable",
    describe: (e, people) => `Retrait en espèces par ${personName(e.actorId, people)}.`,
  },
  call_record: {
    type: "call_log",
    requiresLabAnalysis: null,
    baseReliability: "reliable",
    describe: (e, people) =>
      `Appel entre ${personName(e.actorId, people)} et ${e.counterpartyId ? personName(e.counterpartyId, people) : "un correspondant"}.`,
  },
  sms_record: {
    type: "sms_log",
    requiresLabAnalysis: null,
    baseReliability: "reliable",
    describe: (e, people) =>
      `SMS entre ${personName(e.actorId, people)} et ${e.counterpartyId ? personName(e.counterpartyId, people) : "un correspondant"}.`,
  },
};

const CRIME_WINDOW_MINUTES = 8 * 60;

function computeDiscoverability(
  event: TimelineEvent,
  crimeTimestamp: GameMinutes,
): { discoveryDifficulty: number; isNearCrime: boolean } {
  const distanceFromCrime = Math.abs(event.timestamp - crimeTimestamp);
  const isNearCrime = event.isCrimeEvent || distanceFromCrime <= CRIME_WINDOW_MINUTES;
  const discoveryDifficulty = isNearCrime ? 0.25 : 0.6;
  return { discoveryDifficulty, isNearCrime };
}

export interface DeriveEvidenceOptions {
  caseOpenedAt: GameMinutes;
  crimeTimestamp: GameMinutes;
  contaminationChance?: number;
  /** Chance a physical trace near the crime turns out to have been
   * tampered with (planted, wiped, or altered) rather than merely
   * mishandled. Rarer than plain contamination and, unlike it, leaves a
   * visible note in the description once analyzed — tampering is a clue
   * in its own right, not just noise. */
  tamperingChance?: number;
}

const TAMPERABLE_TYPES: EvidenceType[] = ["fingerprint", "dna", "blood", "fiber", "shoeprint", "tire_track"];

export function deriveEvidenceFromTimeline(
  rng: RNG,
  timeline: TimelineEvent[],
  people: Person[],
  locations: Location[],
  options: DeriveEvidenceOptions,
): Evidence[] {
  const peopleById = new Map(people.map((p) => [p.id, p]));
  const locationsById = new Map(locations.map((l) => [l.id, l]));
  const contamination = options.contaminationChance ?? 0.06;
  const tampering = options.tamperingChance ?? 0.03;
  const evidence: Evidence[] = [];

  for (const event of timeline) {
    for (const tag of event.evidenceSourceTags) {
      const mapping = TAG_MAPPINGS[tag];
      if (!mapping) continue;
      const { discoveryDifficulty } = computeDiscoverability(event, options.crimeTimestamp);
      const isTampered = TAMPERABLE_TYPES.includes(mapping.type) && rng.bool(tampering);
      const reliability: EvidenceReliability = isTampered ? "falsified" : rng.bool(contamination) ? "contaminated" : mapping.baseReliability;
      const relatedPersonIds = [event.actorId, ...(event.counterpartyId ? [event.counterpartyId] : [])];
      const baseDescription = mapping.describe(event, peopleById, locationsById);

      evidence.push({
        id: rng.id("ev"),
        family: EVIDENCE_FAMILY_BY_TYPE[mapping.type],
        type: mapping.type,
        sourceEventId: event.id,
        sourceLocationId: event.locationId,
        relatedPersonIds,
        relatedLocationIds: [event.locationId],
        timestamp: event.timestamp,
        discoverableAt: Math.max(event.timestamp, options.caseOpenedAt),
        discoveryDifficulty,
        reliability,
        requiresLabAnalysis: mapping.requiresLabAnalysis,
        isRedHerring: false,
        status: "undiscovered",
        description: isTampered ? `${baseDescription} Des traces de manipulation ont été relevées lors de l'analyse.` : baseDescription,
      });
    }
  }

  return evidence;
}

/**
 * Deliberately misleading evidence, tied to an innocent person's unrelated
 * activity, that a player could plausibly (mis)read as incriminating. Kept
 * structurally identical to real evidence (still grounded in a real,
 * synthetic-but-consistent event) so it can't be filtered out by "shape".
 */
export function generateRedHerrings(
  rng: RNG,
  suspects: Person[],
  locations: Location[],
  options: DeriveEvidenceOptions,
  count: number,
): Evidence[] {
  if (suspects.length === 0 || count <= 0) return [];
  const flavors: { type: EvidenceType; describe: (p: Person, l: Location) => string; lab: LabAnalysisType | null }[] = [
    {
      type: "card_payment",
      describe: (p, l) => `${p.firstName} ${p.lastName} a acheté des gants en caoutchouc à ${l.name}, sans lien établi avec l'affaire.`,
      lab: null,
    },
    {
      type: "browser_history",
      describe: (p) => `L'historique de navigation de ${p.firstName} ${p.lastName} contient des recherches sur des sujets sensibles, sans rapport confirmé avec l'affaire.`,
      lab: "digital_forensics",
    },
    {
      type: "witness_statement",
      describe: (p, l) => `Un témoin affirme avoir vu ${p.firstName} ${p.lastName} près de ${l.name} ce soir-là, pour une raison sans lien avec le crime.`,
      lab: null,
    },
  ];

  const shops = locations.filter((l) => l.type === "shop" || l.type === "pharmacy");
  const chosen = rng.sample(suspects, Math.min(count, suspects.length));
  return chosen.map((person) => {
    const flavor = rng.pick(flavors);
    const location = shops.length > 0 ? rng.pick(shops) : rng.pick(locations);
    return {
      id: rng.id("ev"),
      family: EVIDENCE_FAMILY_BY_TYPE[flavor.type],
      type: flavor.type,
      sourceEventId: null,
      sourceLocationId: location.id,
      relatedPersonIds: [person.id],
      relatedLocationIds: [location.id],
      timestamp: options.crimeTimestamp - rng.int(60, 24 * 60),
      discoverableAt: options.caseOpenedAt,
      discoveryDifficulty: rng.range(0.4, 0.8),
      reliability: "ambiguous",
      requiresLabAnalysis: flavor.lab,
      isRedHerring: true,
      status: "undiscovered",
      description: flavor.describe(person, location),
    };
  });
}
