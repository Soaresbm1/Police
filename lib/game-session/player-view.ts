import type { CaseTruth } from "@/lib/game-engine/types/case";
import { toCaseBriefing } from "@/lib/game-engine/types/case";
import type { Person, PersonId } from "@/lib/game-engine/types/person";
import type { Evidence } from "@/lib/game-engine/types/evidence";
import type { GameSession, EvidencePlayerStatus, InvestigationEvent, InvestigationEventType } from "./types";
import { formatGameTime, type GameMinutes } from "@/lib/game-engine/types/time";
import { travelMinutes } from "@/lib/game-engine/types/location";
import { describeMandateEvent } from "./mandates";
import { readyUnseenCount, visibleEvents } from "./events";

/** Public-safe view of a Person — deliberately omits `roles` (which
 * encodes who the culprit is) and any other ground-truth-only fields. */
export interface PersonPublicView {
  id: PersonId;
  firstName: string;
  lastName: string;
  age: number;
  sex: "male" | "female";
  profession: string;
  homeLocationId: string;
  workLocationId: string | null;
  avatarSeed: string;
  phoneNumber: string;
  hasVehicle: boolean;
  vehiclePlate: string | null;
  vehicleDescription: string | null;
  isVictim: boolean;
  isSuspect: boolean;
}

function toPublicPerson(truth: CaseTruth, person: Person): PersonPublicView {
  return {
    id: person.id,
    firstName: person.firstName,
    lastName: person.lastName,
    age: person.age,
    sex: person.sex,
    profession: person.profession,
    homeLocationId: person.homeLocationId,
    workLocationId: person.workLocationId,
    avatarSeed: person.avatarSeed,
    phoneNumber: person.phoneNumber,
    hasVehicle: person.vehicle !== null,
    vehiclePlate: person.vehicle?.plate ?? null,
    vehicleDescription: person.vehicle ? `${person.vehicle.make} ${person.vehicle.model}, ${person.vehicle.color}` : null,
    isVictim: person.id === truth.victimId,
    isSuspect: truth.suspectIds.includes(person.id),
  };
}

export function getBriefing(truth: CaseTruth) {
  return toCaseBriefing(truth);
}

export function getAllPeople(truth: CaseTruth): PersonPublicView[] {
  return truth.people.map((p) => toPublicPerson(truth, p));
}

export function getSuspects(truth: CaseTruth): PersonPublicView[] {
  return truth.suspectIds.map((id) => toPublicPerson(truth, truth.people.find((p) => p.id === id)!));
}

export function getWitnesses(truth: CaseTruth): PersonPublicView[] {
  return truth.people
    .filter((p) => p.id !== truth.victimId && !truth.suspectIds.includes(p.id))
    .map((p) => toPublicPerson(truth, p));
}

export function getPerson(truth: CaseTruth, personId: PersonId): PersonPublicView | undefined {
  const p = truth.people.find((person) => person.id === personId);
  return p ? toPublicPerson(truth, p) : undefined;
}

export function evidenceStatusOf(session: GameSession, evidenceId: string): EvidencePlayerStatus {
  return session.evidenceStatus[evidenceId] ?? "undiscovered";
}

export interface VisibleEvidence extends Evidence {
  playerStatus: EvidencePlayerStatus;
}

/** Only evidence the player has actually discovered — undiscovered evidence
 * is entirely absent, not merely hidden/blurred. */
export function getVisibleEvidence(truth: CaseTruth, session: GameSession): VisibleEvidence[] {
  return truth.evidence
    .filter((ev) => evidenceStatusOf(session, ev.id) !== "undiscovered")
    .map((ev) => ({ ...ev, playerStatus: evidenceStatusOf(session, ev.id) }));
}

export function getVisibleEvidenceForPerson(truth: CaseTruth, session: GameSession, personId: PersonId): VisibleEvidence[] {
  return getVisibleEvidence(truth, session).filter((ev) => ev.relatedPersonIds.includes(personId));
}

export function getVisibleEvidenceForLocation(truth: CaseTruth, session: GameSession, locationId: string): VisibleEvidence[] {
  return getVisibleEvidence(truth, session).filter((ev) => ev.relatedLocationIds.includes(locationId));
}

export interface KnownTimelineFact {
  id: string;
  time: number;
  timeLabel: string;
  description: string;
  personIds: PersonId[];
  sourceEvidenceId: string;
}

/** The player never sees the ground-truth timeline directly — only what
 * discovered, timestamped evidence implies. This is what populates the
 * Chronologie screen's "known facts" column. */
export function getKnownTimelineFacts(truth: CaseTruth, session: GameSession): KnownTimelineFact[] {
  return getVisibleEvidence(truth, session)
    .map((ev) => ({
      id: ev.id,
      time: ev.timestamp,
      timeLabel: formatGameTime(ev.timestamp),
      description: ev.description,
      personIds: ev.relatedPersonIds,
      sourceEvidenceId: ev.id,
    }))
    .sort((a, b) => a.time - b.time);
}

export function getLocation(truth: CaseTruth, locationId: string) {
  return truth.locations.find((l) => l.id === locationId);
}

/** Every location in town known to be camera-equipped — this is public
 * infrastructure knowledge (an officer knows a bank or gas station has
 * cameras), not a secret the player has to discover first. */
/** Private homes all share the same generic name ("Maison privée",
 * "Appartement privé") — disambiguate with the street address so lists and
 * search results don't show several indistinguishable "Maison privée". */
export function displayLocationName(location: { name: string; address: string; type: string }): string {
  return location.type === "house" || location.type === "apartment" ? `${location.name} (${location.address})` : location.name;
}

export interface MapLocationView {
  id: string;
  name: string;
  address: string;
  x: number;
  y: number;
  district: string;
  category: "crime_scene" | "home" | "work" | "evidence";
  occupantNames: string[];
  discoveredEvidenceCount: number;
  /** In-game timestamps of every discovered evidence item tied to this
   * location — powers the map's known-movements time slider. Never
   * includes undiscovered events (see `getVisibleEvidence`). */
  discoveredEventTimestamps: number[];
  travelMinutesFromSceneCar: number;
  travelMinutesFromSceneFoot: number;
}

const TOWN_SIZE_KM = 8;

/**
 * Locations to plot on the investigation map. Deliberately does **not**
 * expose every location the engine generated — only the crime scene, every
 * person's home/workplace (already public identity info elsewhere in the
 * UI, e.g. the person profile's "Domicile" field), and any location tied to
 * *discovered* evidence. A location whose only significance is an
 * undiscovered clue (a red-herring sighting, an unfound waypoint) gets no
 * marker at all, so the map can never hint at hidden truth.
 */
export function getMapLocations(truth: CaseTruth, session: GameSession): MapLocationView[] {
  const byId = new Map<string, MapLocationView>();
  const toPct = (km: number) => Math.min(100, Math.max(0, (km / TOWN_SIZE_KM) * 100));
  const crimeScene = truth.locations.find((l) => l.id === truth.crimeLocationId);

  const upsert = (locationId: string, category: MapLocationView["category"], occupant?: string) => {
    const location = truth.locations.find((l) => l.id === locationId);
    if (!location) return;
    const existing = byId.get(locationId);
    if (existing) {
      if (occupant && !existing.occupantNames.includes(occupant)) existing.occupantNames.push(occupant);
      // A crime scene marker always wins visually over a home/work marker.
      if (category === "crime_scene") existing.category = "crime_scene";
      return;
    }
    byId.set(locationId, {
      id: location.id,
      name: displayLocationName(location),
      address: location.address,
      district: location.district,
      x: toPct(location.coordinates.x),
      y: toPct(location.coordinates.y),
      category,
      occupantNames: occupant ? [occupant] : [],
      discoveredEvidenceCount: 0,
      discoveredEventTimestamps: [],
      travelMinutesFromSceneCar: crimeScene ? travelMinutes(crimeScene.coordinates, location.coordinates, "car") : 0,
      travelMinutesFromSceneFoot: crimeScene ? travelMinutes(crimeScene.coordinates, location.coordinates, "foot") : 0,
    });
  };

  upsert(truth.crimeLocationId, "crime_scene");
  for (const p of truth.people) {
    const fullName = `${p.firstName} ${p.lastName}`;
    upsert(p.homeLocationId, "home", fullName);
    if (p.workLocationId) upsert(p.workLocationId, "work", fullName);
  }
  for (const ev of getVisibleEvidence(truth, session)) {
    for (const locId of ev.relatedLocationIds) upsert(locId, "evidence");
  }
  for (const ev of getVisibleEvidence(truth, session)) {
    for (const locId of ev.relatedLocationIds) {
      const entry = byId.get(locId);
      if (entry) {
        entry.discoveredEvidenceCount += 1;
        entry.discoveredEventTimestamps.push(ev.timestamp);
      }
    }
  }

  return Array.from(byId.values());
}

export function getCameraEquippedLocations(truth: CaseTruth): { id: string; name: string }[] {
  return truth.locations.filter((l) => l.hasCameras).map((l) => ({ id: l.id, name: displayLocationName(l) }));
}

export function getAlibi(truth: CaseTruth, personId: PersonId) {
  return truth.alibis.find((a) => a.personId === personId);
}

export interface MandateOverviewItem {
  key: string;
  kind: "search" | "bank";
  personId: PersonId;
  personName: string;
  /** Reflects the decision EVENT's status, never the raw stored
   * MandateRecord directly — `"pending"` for as long as the decision
   * hasn't actually become available in-world, even though the record
   * underneath may already hold the (not-yet-revealed) outcome. */
  status: "pending" | "granted" | "denied";
  reason: string;
}

/** Every mandate the player has requested so far, for the Mandats app's
 * case log — read from session state, safe to pass to a Client Component
 * since it carries no hidden truth. */
export function getMandateOverview(truth: CaseTruth, session: GameSession): MandateOverviewItem[] {
  return Object.values(session.mandates).map((m) => {
    const [kind, personId] = m.key.split(":") as ["search" | "bank", PersonId];
    const person = truth.people.find((p) => p.id === personId);
    const decision = describeMandateEvent(session, kind, personId);
    return {
      key: m.key,
      kind,
      personId,
      personName: person ? `${person.firstName} ${person.lastName}` : "Inconnu",
      status: decision.status,
      reason: decision.reason,
    };
  });
}

/** Where clicking an investigation-inbox row should navigate — `null`
 * when there's no dedicated destination (shouldn't happen for this
 * milestone's event types, but kept total rather than assuming).
 * `truth` is only needed to resolve a `phone_records` event's personId
 * back to the phone number the Téléphonie app's deep-link expects. */
function eventHref(truth: CaseTruth, event: InvestigationEvent): string | null {
  switch (event.type) {
    case "lab_result":
      return "/investigation/laboratoire";
    case "bank_warrant":
    case "bank_records":
      return `/investigation/applications/banque?person=${event.source.id.split(":")[1] ?? ""}`;
    case "search_warrant":
      return `/investigation/applications/mandats?person=${event.source.id.split(":")[1] ?? ""}`;
    case "cctv_footage":
      return `/investigation/applications/cameras?location=${event.source.id}`;
    case "phone_records": {
      const person = truth.people.find((p) => p.id === event.source.id);
      return person ? `/investigation/applications/telephonie?tel=${encodeURIComponent(person.phoneNumber)}` : "/investigation/applications/telephonie";
    }
    case "witness_callback":
      return `/investigation/interrogatoires/${event.source.id}`;
    default:
      return null;
  }
}

export interface InvestigationEventView {
  id: string;
  type: InvestigationEventType;
  title: string;
  detail: string;
  scheduledAt: GameMinutes;
  scheduledAtLabel: string;
  status: "ready" | "seen";
  href: string | null;
}

/** `ready`/`seen` events only, in display order — the investigation
 * inbox's data source. A `scheduled` event never appears here: the
 * player must never learn something is coming before it's actually
 * arrived (see `events.ts#visibleEvents`). */
export function getInvestigationEventsView(truth: CaseTruth, session: GameSession): InvestigationEventView[] {
  return visibleEvents(session).map((event) => ({
    id: event.id,
    type: event.type,
    title: event.payload.title,
    detail: event.payload.detail,
    scheduledAt: event.scheduledAt,
    scheduledAtLabel: formatGameTime(event.scheduledAt),
    status: event.status as "ready" | "seen",
    href: eventHref(truth, event),
  }));
}

/** What the TopBar badge counts and what the notification-sound
 * component watches for increases — `ready`, not-yet-`seen` events only. */
export function getReadyUnseenEventCount(session: GameSession): number {
  return readyUnseenCount(session);
}

export interface BoardPaletteItem {
  kind: "person" | "evidence" | "location";
  refId: string;
  label: string;
  detail: string;
}

/** Everything the player currently knows about and could drag onto the
 * evidence board: every person (their existence isn't secret, only their
 * guilt is), every discovered evidence item, and every location referenced
 * by a discovered evidence item. */
export function getBoardPalette(truth: CaseTruth, session: GameSession): BoardPaletteItem[] {
  const people: BoardPaletteItem[] = truth.people.map((p) => ({
    kind: "person",
    refId: p.id,
    label: `${p.firstName} ${p.lastName}`,
    detail: p.profession,
  }));

  const visibleEvidence = getVisibleEvidence(truth, session);
  const evidenceItems: BoardPaletteItem[] = visibleEvidence.map((ev) => ({
    kind: "evidence",
    refId: ev.id,
    label: ev.type,
    detail: ev.description,
  }));

  const locationIds = new Set(visibleEvidence.flatMap((ev) => ev.relatedLocationIds));
  const locationItems: BoardPaletteItem[] = truth.locations
    .filter((l) => locationIds.has(l.id))
    .map((l) => ({ kind: "location", refId: l.id, label: l.name, detail: l.address }));

  return [...people, ...evidenceItems, ...locationItems];
}

export interface DiscoveredRelationship {
  id: string;
  fromId: PersonId;
  toId: PersonId;
  type: string;
}

/**
 * A relationship only becomes visible to the player once investigation has
 * actually surfaced it — either evidence ties both people together, or an
 * interrogation answer mentioned the other person. This keeps the Relations
 * screen from being a free spoiler of the full social graph.
 */
export function getDiscoveredRelationships(truth: CaseTruth, session: GameSession): DiscoveredRelationship[] {
  const visibleEvidence = getVisibleEvidence(truth, session);
  const eventsById = new Map(truth.timeline.map((e) => [e.id, e]));

  const mentionedPairs = new Set<string>();
  for (const [personId, factIds] of Object.entries(session.interrogated)) {
    for (const factId of factIds) {
      const fact = truth.knowledge.find((f) => f.id === factId);
      const event = fact ? eventsById.get(fact.aboutEventId) : undefined;
      if (event?.counterpartyId && event.counterpartyId !== personId) {
        mentionedPairs.add([personId, event.counterpartyId].sort().join("|"));
      }
    }
  }

  return truth.relationships
    .filter((rel) => {
      const pairKey = [rel.from, rel.to].sort().join("|");
      if (mentionedPairs.has(pairKey)) return true;
      return visibleEvidence.some((ev) => ev.relatedPersonIds.includes(rel.from) && ev.relatedPersonIds.includes(rel.to));
    })
    .map((rel) => ({ id: rel.id, fromId: rel.from, toId: rel.to, type: rel.type }));
}

/** Cross-references a person's alibi claim against discovered evidence —
 * the same generic support/contradiction logic the engine uses, but scoped
 * to what the player has actually found so far, so the game never spoils
 * the answer for evidence still undiscovered. */
export function getAlibiAssessment(
  truth: CaseTruth,
  session: GameSession,
  personId: PersonId,
): { corroborating: VisibleEvidence[]; contradicting: VisibleEvidence[] } | null {
  const alibi = getAlibi(truth, personId);
  if (!alibi) return null;
  const visible = getVisibleEvidence(truth, session);
  return {
    corroborating: visible.filter((ev) => alibi.corroboratingEvidenceIds.includes(ev.id)),
    contradicting: visible.filter((ev) => alibi.contradictingEvidenceIds.includes(ev.id)),
  };
}
