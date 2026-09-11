import type { RNG } from "../random/rng";
import type { Person } from "../types/person";
import type { Location } from "../types/location";
import type { GameMinutes } from "../types/time";
import type { EvidenceSourceTag, TimelineEvent } from "../types/timeline";
import type { Evidence, EvidenceReliability, EvidenceType, FinancialTransactionDetails, LabAnalysisType } from "../types/evidence";
import { EVIDENCE_FAMILY_BY_TYPE } from "../types/evidence";

interface TagMapping {
  type: EvidenceType;
  requiresLabAnalysis: LabAnalysisType | null;
  baseReliability: EvidenceReliability;
  /** `financialDetails` is already resolved (see `financialDetails` below)
   * by the time `describe` runs, so a financial mapping's own `describe`
   * can build its sentence from the SAME real amount/counterparty the
   * player later sees in the structured detail view — never a mismatched
   * placeholder. `null` for every non-financial mapping. */
  describe: (event: TimelineEvent, people: Map<string, Person>, locations: Map<string, Location>, financialDetails: FinancialTransactionDetails | null) => string;
  /** Only set for financial-family mappings — builds the structured detail
   * (`Evidence.financialDetails`) a card-payment/withdrawal/transfer
   * actually carries. Given its own RNG sub-stream (never the shared
   * per-event `rng`) purely for the amount roll, so adding/removing a
   * financial tag mapping can never perturb any other evidence's fields. */
  financialDetails?: (rng: RNG, event: TimelineEvent, people: Map<string, Person>, locations: Map<string, Location>) => FinancialTransactionDetails;
}

function personName(id: string, people: Map<string, Person>): string {
  const p = people.get(id);
  return p ? `${p.firstName} ${p.lastName}` : "Personne inconnue";
}

function locationName(id: string, locations: Map<string, Location>): string {
  return locations.get(id)?.name ?? "Lieu inconnu";
}

export function formatChf(amount: number): string {
  return `CHF ${amount.toLocaleString("fr-CH")}.–`;
}

const TAG_MAPPINGS: Partial<Record<EvidenceSourceTag, TagMapping>> = {
  camera: {
    type: "camera_footage",
    requiresLabAnalysis: null,
    baseReliability: "reliable",
    // Deliberately does NOT name the person here — ground-truth identity
    // is only ever safe to reveal through `buildCCTVFrameDescriptor`'s own
    // `identifiable`/`visiblePersonIds` gate (lib/art/cctv.ts), which can
    // independently downgrade a frame to unidentifiable (low light,
    // contamination, distance). Naming someone unconditionally here would
    // let the evidence's own description text leak an identification the
    // frame quality itself says isn't actually supported.
    describe: (e, people, locations) => `Vidéosurveillance de ${locationName(e.locationId, locations)} : une personne a été enregistrée à cette heure.`,
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
    describe: (e, people, locations, fin) => `Paiement carte — ${fin!.counterpartyLabel} — ${formatChf(fin!.amountChf)}.`,
    financialDetails: (rng, e, people, locations) => ({
      amountChf: rng.int(15, 150),
      direction: "debit",
      counterpartyLabel: locationName(e.locationId, locations),
    }),
  },
  cash_withdrawal: {
    type: "cash_withdrawal",
    requiresLabAnalysis: null,
    baseReliability: "reliable",
    describe: (e, people, locations, fin) => `Retrait en espèces — ${fin!.counterpartyLabel} — ${formatChf(fin!.amountChf)}.`,
    financialDetails: (rng, e, people, locations) => ({
      amountChf: rng.int(50, 300),
      direction: "debit",
      counterpartyLabel: `Distributeur — ${locationName(e.locationId, locations)}`,
    }),
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
      // Resolved BEFORE describe() so a financial mapping's sentence and its
      // structured detail always agree on the same amount — never a
      // mismatched placeholder. Own derived sub-stream (never the shared
      // `rng` directly) so this roll can't perturb the tampering/
      // contamination/id draws below for any event, financial or not.
      const financialDetails = mapping.financialDetails ? mapping.financialDetails(rng.derive(`financial-${event.id}`), event, peopleById, locationsById) : null;
      const baseDescription = mapping.describe(event, peopleById, locationsById, financialDetails);

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
        ...(financialDetails ? { financialDetails } : {}),
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
    // Own derived sub-stream (never the shared `rng` directly) — the same
    // discipline as `deriveEvidenceFromTimeline`'s `financial-${event.id}`
    // roll. Historical-compatibility audit: drawing this amount straight
    // from the shared `rng` shifted every subsequent `rng.id("ev")` call's
    // `callCount` (see rng.ts), silently changing already-persisted red-
    // herring evidence ids for any case where a chosen flavor happened to
    // be `card_payment` — confirmed empirically across 20 fixed seeds
    // before this fix. Isolating the roll here restores exact id parity.
    const financialDetails: FinancialTransactionDetails | undefined =
      flavor.type === "card_payment"
        ? { amountChf: rng.derive(`red-herring-financial-${person.id}`).int(15, 150), direction: "debit", counterpartyLabel: location.name }
        : undefined;
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
      ...(financialDetails ? { financialDetails } : {}),
    };
  });
}

const AMBIENT_MERCHANT_TYPES: Location["type"][] = ["shop", "pharmacy", "gas_station", "restaurant", "bar"];
const AMBIENT_AMOUNT_RANGE: Partial<Record<Location["type"], [number, number]>> = {
  shop: [15, 120],
  pharmacy: [10, 80],
  gas_station: [60, 150],
  restaurant: [15, 90],
  bar: [8, 60],
};

/**
 * Ordinary, mundane financial background activity (groceries, fuel, a meal
 * out, a cash withdrawal) — never tied to any real timeline event, never
 * flagged as relevant in any way (project brief §6: no `suspicious`/
 * `relevantToCrime` field anywhere in this codebase). Exists purely so a
 * suspect's bank statement isn't ONLY the handful of narratively-real
 * transactions the rest of the engine happens to produce — a player has to
 * actually reason about which entries matter, the same way they already do
 * for every other evidence family. Deterministic, own RNG sub-stream per
 * person (`ambient-${person.id}`), so this can never perturb anything else
 * derived from the same root seed.
 */
export function generateAmbientFinancialActivity(
  rng: RNG,
  suspects: Person[],
  locations: Location[],
  options: DeriveEvidenceOptions,
): Evidence[] {
  const merchants = locations.filter((l) => AMBIENT_MERCHANT_TYPES.includes(l.type));
  const banks = locations.filter((l) => l.type === "bank");
  if (merchants.length === 0 && banks.length === 0) return [];

  const evidence: Evidence[] = [];
  for (const person of suspects) {
    const personRng = rng.derive(`ambient-${person.id}`);
    const count = personRng.int(1, 3);
    for (let i = 0; i < count; i++) {
      const itemRng = personRng.derive(`item-${i}`);
      const wantsWithdrawal = itemRng.bool(0.3) || merchants.length === 0;
      const timestamp = options.crimeTimestamp - itemRng.int(60, 3 * 24 * 60);

      if (wantsWithdrawal && banks.length > 0) {
        const bank = itemRng.pick(banks);
        const amountChf = itemRng.int(50, 300);
        evidence.push({
          id: itemRng.id("ev"),
          family: "financial",
          type: "cash_withdrawal",
          sourceEventId: null,
          sourceLocationId: bank.id,
          relatedPersonIds: [person.id],
          relatedLocationIds: [bank.id],
          timestamp,
          discoverableAt: options.caseOpenedAt,
          discoveryDifficulty: itemRng.range(0.3, 0.5),
          reliability: "reliable",
          requiresLabAnalysis: null,
          isRedHerring: false,
          status: "undiscovered",
          description: `Retrait en espèces — ${bank.name} — ${formatChf(amountChf)}.`,
          financialDetails: { amountChf, direction: "debit", counterpartyLabel: `Distributeur — ${bank.name}` },
        });
      } else if (merchants.length > 0) {
        const merchant = itemRng.pick(merchants);
        const [min, max] = AMBIENT_AMOUNT_RANGE[merchant.type] ?? [15, 100];
        const amountChf = itemRng.int(min, max);
        evidence.push({
          id: itemRng.id("ev"),
          family: "financial",
          type: "card_payment",
          sourceEventId: null,
          sourceLocationId: merchant.id,
          relatedPersonIds: [person.id],
          relatedLocationIds: [merchant.id],
          timestamp,
          discoverableAt: options.caseOpenedAt,
          discoveryDifficulty: itemRng.range(0.3, 0.5),
          reliability: "reliable",
          requiresLabAnalysis: null,
          isRedHerring: false,
          status: "undiscovered",
          description: `Paiement carte — ${merchant.name} — ${formatChf(amountChf)}.`,
          financialDetails: { amountChf, direction: "debit", counterpartyLabel: merchant.name },
        });
      }
    }
  }
  return evidence;
}
