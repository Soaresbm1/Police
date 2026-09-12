"use server";

import { revalidatePath } from "next/cache";
import { withSession, type SessionContext } from "./with-session";
import * as discovery from "./discovery";
import { describeMandateEvent, evaluateBankRecordsRequest, requestMandateWithDelay, type MandateRequestOutcome } from "./mandates";
import { requestCctvFootage } from "./cctv";
import { requestPhoneRecords } from "./phone-records";
import { displayLocationName, getVisibleEvidenceForPerson } from "./player-view";
import { getCriminalRecord, type CriminalRecordEntry } from "./criminal-record";
import { formatGameTime } from "@/lib/game-engine/types/time";
import { formatChf } from "@/lib/game-engine/evidence/evidence-generator";
import { FINANCIAL_DIRECTION_LABEL, RECORD_TYPE_LABEL } from "./labels";
import { buildCCTVFrameDescriptor, describeCCTVObservation, identifiedNamesForCCTV, type CCTVFrameDescriptor } from "@/lib/art/cctv";
import { CCTV_QUALITY_LABEL } from "@/lib/art/cctv-renderer";
import { buildCCTVSequence, type CCTVSequenceDescriptor } from "@/lib/art/cctv-sequence";
import { getLabReport, labResultEventId, type LabReportView } from "./lab-report";
import { markEventSeen } from "./events";
import { escalateHint, getHintHistoryView, getNextHint, type HintHistoryView, type HintPayload } from "./hints";

/** Every search-type action pays a small, believable amount of in-game time
 * — real bureaucratic lookups aren't instant — advancing the clock so the
 * player feels the cost of casting a wide net. */
function payTime(session: SessionContext["session"], minutes: number) {
  discovery.advanceTime(session, minutes);
}

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
  /** `"not_found"` when no subscriber matches; otherwise reflects the
   * phone_records event — `"pending"` while the operator's log is still
   * in transit, `"ready"` once `lines` is actually populated. Identity
   * (`found`/`ownerName`/`personId`) is resolved instantly regardless —
   * only the detailed record content is gated. */
  status: "not_found" | "pending" | "ready";
  personId?: string;
  ownerName?: string;
  lines: RecordLine[];
}

export async function searchPhoneAction(query: string): Promise<PhoneSearchResult> {
  const result = await withSession(({ session, truth }) => {
    const normalizedQuery = normalizePhone(query);
    // Real dispatcher/operator work: identifying who a number belongs
    // to. Unchanged from before this milestone — this step was always
    // instant and stays instant; only the deeper record retrieval below
    // is now asynchronous.
    payTime(session, 5);

    if (normalizedQuery.length < 6) return { query, found: false, status: "not_found" as const, lines: [] };

    const owner = truth.people.find((p) => normalizePhone(p.phoneNumber) === normalizedQuery);
    if (!owner) return { query, found: false, status: "not_found" as const, lines: [] };

    const outcome = requestPhoneRecords(session, owner.id);
    if (outcome.status !== "ready") {
      return { query, found: true, personId: owner.id, ownerName: `${owner.firstName} ${owner.lastName}`, status: outcome.status, lines: [] };
    }

    discovery.checkDigitalRecords(truth, session, owner.id);
    const lines: RecordLine[] = getVisibleEvidenceForPerson(truth, session, owner.id)
      .filter((ev) => ev.family === "digital")
      .map((ev) => ({ id: ev.id, timeLabel: formatGameTime(ev.timestamp), time: ev.timestamp, typeLabel: RECORD_TYPE_LABEL[ev.type], detail: ev.description }))
      .sort((a, b) => a.time - b.time);

    return { query, found: true, personId: owner.id, ownerName: `${owner.firstName} ${owner.lastName}`, status: "ready" as const, lines };
  });
  revalidatePath("/investigation", "layout");
  return result;
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
  const result = await withSession(({ session, truth }) => {
    payTime(session, 3);
    const normalizedQuery = normalizePlate(query);
    if (normalizedQuery.length < 3) return { query, matches: [] };

    const matches: VehicleMatch[] = truth.people
      .filter((p) => p.vehicle && normalizePlate(p.vehicle.plate).includes(normalizedQuery))
      .map((p) => ({
        personId: p.id,
        ownerName: `${p.firstName} ${p.lastName}`,
        plate: p.vehicle!.plate,
        description: `${p.vehicle!.make} ${p.vehicle!.model}, ${p.vehicle!.color}`,
      }));

    return { query, matches };
  });
  revalidatePath("/investigation", "layout");
  return result;
}

export interface CriminalRecordResult {
  personId: string;
  ownerName: string;
  entries: CriminalRecordEntry[];
}

export async function searchCriminalRecordAction(personId: string): Promise<CriminalRecordResult> {
  const result = await withSession(({ session, truth }) => {
    payTime(session, 4);
    const person = truth.people.find((p) => p.id === personId);
    if (!person) throw new Error("Personne introuvable.");
    return { personId, ownerName: `${person.firstName} ${person.lastName}`, entries: getCriminalRecord(person) };
  });
  revalidatePath("/investigation", "layout");
  return result;
}

export interface CameraRecordLine extends RecordLine {
  frame: CCTVFrameDescriptor;
  cameraId: string;
  qualityLabel: string;
  /** Safe observation sentence — see `lib/art/cctv.ts#describeCCTVObservation`.
   * Never names anyone `frame.identifiable` doesn't already say is
   * identifiable. */
  observation: string;
  /** Empty unless `frame.identifiable` is true. */
  identifiedNames: string[];
  /** Playable animation descriptor (Phase 3 — see `lib/art/cctv-sequence.ts`)
   * — `null` when the underlying evidence has no resolvable source event to
   * ground a sequence in, in which case the viewer falls back to the
   * existing static frame. */
  sequence: CCTVSequenceDescriptor | null;
}

export interface CameraSearchResult {
  locationName: string;
  available: boolean;
  /** `"unavailable"` when the location has no cameras at all (a public,
   * instantly-knowable fact — no reason to delay it); otherwise reflects
   * the cctv_footage event — `"pending"` while the tape is still being
   * retrieved, `"ready"` once `lines` is actually populated. */
  status: "unavailable" | "pending" | "ready";
  windowStart: number;
  windowEnd: number;
  lines: CameraRecordLine[];
  moreOutsideWindow: boolean;
}

export async function searchCameraAction(locationId: string, windowStart: number, windowEnd: number): Promise<CameraSearchResult> {
  const result = await withSession(({ session, truth }) => {
    const location = truth.locations.find((l) => l.id === locationId);
    if (!location || !location.hasCameras) {
      return {
        locationName: location ? displayLocationName(location) : "Lieu inconnu",
        available: false,
        status: "unavailable" as const,
        windowStart,
        windowEnd,
        lines: [],
        moreOutsideWindow: false,
      };
    }

    const outcome = requestCctvFootage(session, locationId);
    if (outcome.status !== "ready") {
      return { locationName: displayLocationName(location), available: true, status: outcome.status, windowStart, windowEnd, lines: [], moreOutsideWindow: false };
    }

    discovery.checkCameraFootage(truth, session, locationId);
    const visibleAtLocation = truth.evidence.filter(
      (ev) => ev.type === "camera_footage" && ev.relatedLocationIds.includes(locationId) && session.evidenceStatus[ev.id] && session.evidenceStatus[ev.id] !== "undiscovered",
    );
    const inWindow = visibleAtLocation.filter((ev) => ev.timestamp >= windowStart && ev.timestamp <= windowEnd);
    const outsideWindow = visibleAtLocation.length > inWindow.length;

    const lines: CameraRecordLine[] = inWindow
      .map((ev) => {
        const frame = buildCCTVFrameDescriptor(ev, truth);
        const sourceEvent = ev.sourceEventId ? truth.timeline.find((e) => e.id === ev.sourceEventId) : undefined;
        return {
          id: ev.id,
          timeLabel: formatGameTime(ev.timestamp),
          time: ev.timestamp,
          typeLabel: RECORD_TYPE_LABEL[ev.type],
          detail: ev.description,
          frame,
          cameraId: frame.cameraId,
          qualityLabel: CCTV_QUALITY_LABEL[frame.visibilityQuality],
          observation: describeCCTVObservation(frame, truth),
          identifiedNames: identifiedNamesForCCTV(frame, truth),
          sequence: buildCCTVSequence(ev.id, frame, sourceEvent),
        };
      })
      .sort((a, b) => a.time - b.time);

    return { locationName: displayLocationName(location), available: true, status: "ready" as const, windowStart, windowEnd, lines, moreOutsideWindow: outsideWindow };
  });
  revalidatePath("/investigation", "layout");
  return result;
}

export interface FinancialRecordLine extends RecordLine {
  amountLabel: string;
  directionLabel: string;
  counterpartyLabel: string;
}

export interface BankSearchResult {
  personId: string;
  ownerName: string;
  status: "no_mandate" | "pending" | "denied" | "pending_records" | "ready";
  mandateReason: string;
  lines: FinancialRecordLine[];
}

export async function requestBankMandateAppAction(personId: string): Promise<MandateRequestOutcome> {
  const result = await withSession(({ session, truth }) => requestMandateWithDelay(truth, session, "bank", personId));
  revalidatePath("/investigation", "layout");
  return result;
}

export async function searchBankAction(personId: string): Promise<BankSearchResult> {
  const result = await withSession(({ session, truth }) => {
    const person = truth.people.find((p) => p.id === personId);
    if (!person) throw new Error("Personne introuvable.");
    const ownerName = `${person.firstName} ${person.lastName}`;

    const outcome = evaluateBankRecordsRequest(session, personId);
    if (outcome.status !== "ready") {
      return { personId, ownerName, status: outcome.status, mandateReason: outcome.reason, lines: [] };
    }

    discovery.checkBankRecords(truth, session, personId);
    const lines: FinancialRecordLine[] = getVisibleEvidenceForPerson(truth, session, personId)
      .filter((ev) => ev.family === "financial")
      .map((ev) => ({
        id: ev.id,
        timeLabel: formatGameTime(ev.timestamp),
        time: ev.timestamp,
        typeLabel: RECORD_TYPE_LABEL[ev.type],
        detail: ev.description,
        amountLabel: ev.financialDetails ? formatChf(ev.financialDetails.amountChf) : "",
        directionLabel: ev.financialDetails ? FINANCIAL_DIRECTION_LABEL[ev.financialDetails.direction] : "",
        counterpartyLabel: ev.financialDetails?.counterpartyLabel ?? "",
      }))
      .sort((a, b) => a.time - b.time);

    return { personId, ownerName, status: "ready" as const, mandateReason: outcome.reason, lines };
  });
  revalidatePath("/investigation", "layout");
  return result;
}

export async function requestSearchMandateAppAction(personId: string): Promise<MandateRequestOutcome> {
  const result = await withSession(({ session, truth }) => requestMandateWithDelay(truth, session, "search", personId));
  revalidatePath("/investigation", "layout");
  return result;
}

export interface SearchWarrantResult {
  personId: string;
  ownerName: string;
  locationName: string;
  status: "pending" | "denied" | "ready";
  mandateReason: string;
  lines: RecordLine[];
}

export async function executeSearchWarrantAction(personId: string): Promise<SearchWarrantResult> {
  const result = await withSession(({ session, truth }) => {
    const person = truth.people.find((p) => p.id === personId);
    if (!person) throw new Error("Personne introuvable.");
    const ownerName = `${person.firstName} ${person.lastName}`;
    const location = truth.locations.find((l) => l.id === person.homeLocationId);
    const locationName = location?.name ?? "domicile inconnu";

    // Gate on the decision EVENT's status, never the raw stored
    // MandateRecord — the record is computed (and stored) the instant
    // the warrant is requested, but must stay unusable by the player
    // until its own delay has actually elapsed.
    const decision = describeMandateEvent(session, "search", personId);
    if (decision.status !== "granted") {
      const status: "pending" | "denied" = decision.status === "pending" ? "pending" : "denied";
      return { personId, ownerName, locationName, status, mandateReason: decision.reason, lines: [] };
    }

    // Physical execution time — distinct from the administrative
    // decision delay above; this is the cost of actually going and
    // searching, paid once the player explicitly chooses to execute.
    payTime(session, 20);
    discovery.searchLocation(truth, session, person.homeLocationId);
    const lines: RecordLine[] = truth.evidence
      .filter((ev) => ev.family === "physical" && ev.relatedLocationIds.includes(person.homeLocationId) && session.evidenceStatus[ev.id] && session.evidenceStatus[ev.id] !== "undiscovered")
      .map((ev) => ({ id: ev.id, timeLabel: formatGameTime(ev.timestamp), time: ev.timestamp, typeLabel: RECORD_TYPE_LABEL[ev.type], detail: ev.description }))
      .sort((a, b) => a.time - b.time);

    return { personId, ownerName, locationName, status: "ready" as const, mandateReason: decision.reason, lines };
  });
  revalidatePath("/investigation", "layout");
  return result;
}

/** Fetches the safe, already-gated report for one piece of analyzed
 * evidence (req. 2) — `getLabReport` itself re-checks `playerStatus ===
 * "analyzed"`, so this can never hand back a report for evidence still in
 * the lab queue. */
export async function getLabReportAction(evidenceId: string): Promise<LabReportView | null> {
  return withSession(({ session, truth }) => getLabReport(truth, session, evidenceId));
}

/** Marks the matching `lab_result` event `seen` the first time the player
 * actually opens a report — REPORT READY → REPORT CONSULTED, reusing the
 * existing event status machine rather than a new persisted field. A
 * no-op if no such event was ever scheduled (shouldn't happen for
 * lab-eligible evidence, but never throws either way). */
export async function consultLabReportAction(evidenceId: string): Promise<void> {
  await withSession(({ session }) => {
    const eventId = labResultEventId(session, evidenceId);
    if (eventId) markEventSeen(session, eventId);
  });
  revalidatePath("/investigation", "layout");
}

/**
 * Investigation-guidance system (Phase 2). The browser only ever receives
 * a `HintPayload` (`{hintId, level, text}`, plus an optional `terminal`
 * flag) — never the underlying `HintOpportunity`'s priority/category, and
 * never any CaseTruth field. See `hints.ts`'s module doc comment for the
 * full truth-safety accounting.
 */
export async function getNextHintAction(): Promise<HintPayload> {
  const result = await withSession(({ session, truth }) => getNextHint(truth, session));
  revalidatePath("/investigation", "layout");
  return result;
}

/** "INDICE PLUS PRÉCIS" — escalates the specific hint the player is
 * currently looking at (the client passes back the `hintId` from the
 * payload it already received) by exactly one level. */
export async function escalateHintAction(hintId: string): Promise<HintPayload> {
  const result = await withSession(({ session, truth }) => escalateHint(truth, session, hintId));
  revalidatePath("/investigation", "layout");
  return result;
}

/** The player's own hint-history view (req. 17) — read-only, never
 * mutates session state. */
export async function getHintHistoryAction(): Promise<HintHistoryView[]> {
  return withSession(({ session }) => getHintHistoryView(session));
}
