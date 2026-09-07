"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { generateCase } from "@/lib/game-engine/case-generator/case-truth";
import { getSession } from "./store";
import { SESSION_COOKIE } from "./current";
import * as discovery from "./discovery";
import { evaluateMandate, mandateKey } from "./mandates";
import { displayLocationName, getVisibleEvidenceForPerson } from "./player-view";
import { getCriminalRecord, type CriminalRecordEntry } from "./criminal-record";
import { formatGameTime } from "@/lib/game-engine/types/time";
import type { EvidenceType } from "@/lib/game-engine/types/evidence";

async function requireSession() {
  const jar = await cookies();
  const id = jar.get(SESSION_COOKIE)?.value;
  const session = getSession(id);
  if (!session) throw new Error("Aucune enquête en cours.");
  const truth = generateCase(session.seed, { difficulty: session.difficulty });
  return { session, truth };
}

/** Every search-type action pays a small, believable amount of in-game time
 * — real bureaucratic lookups aren't instant — advancing the clock so the
 * player feels the cost of casting a wide net. */
function payTime(session: Awaited<ReturnType<typeof requireSession>>["session"], minutes: number) {
  discovery.advanceTime(session, minutes);
}

const RECORD_TYPE_LABEL: Record<EvidenceType, string> = {
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

export interface RecordLine {
  id: string;
  timeLabel: string;
  time: number;
  typeLabel: string;
  detail: string;
}

function normalizePhone(value: string): string {
  return value.replace(/[^0-9]/g, "");
}

export interface PhoneSearchResult {
  query: string;
  found: boolean;
  personId?: string;
  ownerName?: string;
  lines: RecordLine[];
}

export async function searchPhoneAction(query: string): Promise<PhoneSearchResult> {
  const { session, truth } = await requireSession();
  const normalizedQuery = normalizePhone(query);
  payTime(session, 5);

  if (normalizedQuery.length < 6) {
    revalidatePath("/investigation", "layout");
    return { query, found: false, lines: [] };
  }

  const owner = truth.people.find((p) => normalizePhone(p.phoneNumber) === normalizedQuery);
  if (!owner) {
    revalidatePath("/investigation", "layout");
    return { query, found: false, lines: [] };
  }

  discovery.checkDigitalRecords(truth, session, owner.id);
  const lines: RecordLine[] = getVisibleEvidenceForPerson(truth, session, owner.id)
    .filter((ev) => ev.family === "digital")
    .map((ev) => ({ id: ev.id, timeLabel: formatGameTime(ev.timestamp), time: ev.timestamp, typeLabel: RECORD_TYPE_LABEL[ev.type], detail: ev.description }))
    .sort((a, b) => a.time - b.time);

  revalidatePath("/investigation", "layout");
  return { query, found: true, personId: owner.id, ownerName: `${owner.firstName} ${owner.lastName}`, lines };
}

export interface VehicleMatch {
  personId: string;
  ownerName: string;
  plate: string;
  description: string;
}

export interface VehicleSearchResult {
  query: string;
  matches: VehicleMatch[];
}

function normalizePlate(value: string): string {
  return value.replace(/[•\s]/g, "").toUpperCase();
}

export async function searchVehicleAction(query: string): Promise<VehicleSearchResult> {
  const { session, truth } = await requireSession();
  payTime(session, 3);
  const normalizedQuery = normalizePlate(query);

  if (normalizedQuery.length < 3) {
    revalidatePath("/investigation", "layout");
    return { query, matches: [] };
  }

  const matches: VehicleMatch[] = truth.people
    .filter((p) => p.vehicle && normalizePlate(p.vehicle.plate).includes(normalizedQuery))
    .map((p) => ({
      personId: p.id,
      ownerName: `${p.firstName} ${p.lastName}`,
      plate: p.vehicle!.plate,
      description: `${p.vehicle!.make} ${p.vehicle!.model}, ${p.vehicle!.color}`,
    }));

  revalidatePath("/investigation", "layout");
  return { query, matches };
}

export interface CriminalRecordResult {
  personId: string;
  ownerName: string;
  entries: CriminalRecordEntry[];
}

export async function searchCriminalRecordAction(personId: string): Promise<CriminalRecordResult> {
  const { session, truth } = await requireSession();
  payTime(session, 4);
  const person = truth.people.find((p) => p.id === personId);
  if (!person) throw new Error("Personne introuvable.");
  revalidatePath("/investigation", "layout");
  return { personId, ownerName: `${person.firstName} ${person.lastName}`, entries: getCriminalRecord(person) };
}

export interface CameraSearchResult {
  locationName: string;
  available: boolean;
  windowStart: number;
  windowEnd: number;
  lines: RecordLine[];
  moreOutsideWindow: boolean;
}

export async function searchCameraAction(locationId: string, windowStart: number, windowEnd: number): Promise<CameraSearchResult> {
  const { session, truth } = await requireSession();
  payTime(session, 8);
  const location = truth.locations.find((l) => l.id === locationId);
  if (!location || !location.hasCameras) {
    revalidatePath("/investigation", "layout");
    return { locationName: location ? displayLocationName(location) : "Lieu inconnu", available: false, windowStart, windowEnd, lines: [], moreOutsideWindow: false };
  }

  discovery.checkCameraFootage(truth, session, locationId);
  const visibleAtLocation = truth.evidence.filter(
    (ev) => ev.type === "camera_footage" && ev.relatedLocationIds.includes(locationId) && session.evidenceStatus[ev.id] && session.evidenceStatus[ev.id] !== "undiscovered",
  );
  const inWindow = visibleAtLocation.filter((ev) => ev.timestamp >= windowStart && ev.timestamp <= windowEnd);
  const outsideWindow = visibleAtLocation.length > inWindow.length;

  const lines: RecordLine[] = inWindow
    .map((ev) => ({ id: ev.id, timeLabel: formatGameTime(ev.timestamp), time: ev.timestamp, typeLabel: RECORD_TYPE_LABEL[ev.type], detail: ev.description }))
    .sort((a, b) => a.time - b.time);

  revalidatePath("/investigation", "layout");
  return { locationName: displayLocationName(location), available: true, windowStart, windowEnd, lines, moreOutsideWindow: outsideWindow };
}

export interface BankSearchResult {
  personId: string;
  ownerName: string;
  mandateGranted: boolean;
  mandateReason: string;
  lines: RecordLine[];
}

export async function requestBankMandateAppAction(personId: string): Promise<{ granted: boolean; reason: string }> {
  const { session, truth } = await requireSession();
  const record = evaluateMandate(truth, session, "bank", personId);
  revalidatePath("/investigation", "layout");
  return { granted: record.granted, reason: record.reason };
}

export async function searchBankAction(personId: string): Promise<BankSearchResult> {
  const { session, truth } = await requireSession();
  const person = truth.people.find((p) => p.id === personId);
  if (!person) throw new Error("Personne introuvable.");
  const ownerName = `${person.firstName} ${person.lastName}`;
  const mandate = session.mandates[mandateKey("bank", personId)];

  if (!mandate?.granted) {
    return { personId, ownerName, mandateGranted: false, mandateReason: mandate?.reason ?? "Aucun mandat demandé.", lines: [] };
  }

  payTime(session, 6);
  discovery.checkBankRecords(truth, session, personId);
  const lines: RecordLine[] = getVisibleEvidenceForPerson(truth, session, personId)
    .filter((ev) => ev.family === "financial")
    .map((ev) => ({ id: ev.id, timeLabel: formatGameTime(ev.timestamp), time: ev.timestamp, typeLabel: RECORD_TYPE_LABEL[ev.type], detail: ev.description }))
    .sort((a, b) => a.time - b.time);

  revalidatePath("/investigation", "layout");
  return { personId, ownerName, mandateGranted: true, mandateReason: mandate.reason, lines };
}

export async function requestSearchMandateAppAction(personId: string): Promise<{ granted: boolean; reason: string }> {
  const { session, truth } = await requireSession();
  const record = evaluateMandate(truth, session, "search", personId);
  revalidatePath("/investigation", "layout");
  return { granted: record.granted, reason: record.reason };
}

export interface SearchWarrantResult {
  personId: string;
  ownerName: string;
  locationName: string;
  mandateGranted: boolean;
  mandateReason: string;
  lines: RecordLine[];
}

export async function executeSearchWarrantAction(personId: string): Promise<SearchWarrantResult> {
  const { session, truth } = await requireSession();
  const person = truth.people.find((p) => p.id === personId);
  if (!person) throw new Error("Personne introuvable.");
  const ownerName = `${person.firstName} ${person.lastName}`;
  const location = truth.locations.find((l) => l.id === person.homeLocationId);
  const locationName = location?.name ?? "domicile inconnu";
  const mandate = session.mandates[mandateKey("search", personId)];

  if (!mandate?.granted) {
    return { personId, ownerName, locationName, mandateGranted: false, mandateReason: mandate?.reason ?? "Aucun mandat demandé.", lines: [] };
  }

  payTime(session, 20);
  discovery.searchLocation(truth, session, person.homeLocationId);
  const lines: RecordLine[] = truth.evidence
    .filter((ev) => ev.family === "physical" && ev.relatedLocationIds.includes(person.homeLocationId) && session.evidenceStatus[ev.id] && session.evidenceStatus[ev.id] !== "undiscovered")
    .map((ev) => ({ id: ev.id, timeLabel: formatGameTime(ev.timestamp), time: ev.timestamp, typeLabel: RECORD_TYPE_LABEL[ev.type], detail: ev.description }))
    .sort((a, b) => a.time - b.time);

  revalidatePath("/investigation", "layout");
  return { personId, ownerName, locationName, mandateGranted: true, mandateReason: mandate.reason, lines };
}
