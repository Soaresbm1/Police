import type { RNG } from "../random/rng";
import type { Person, PersonId } from "../types/person";
import type { Location, LocationId, TravelMode } from "../types/location";
import { travelMinutes } from "../types/location";
import type { GameMinutes } from "../types/time";
import { hm } from "../types/time";
import type { EvidenceSourceTag, TimelineEvent, TimelineActionType } from "../types/timeline";
import type { Relationship } from "../types/relationship";
import { RelationshipGraph } from "../types/relationship";
import { findRouteWaypoint } from "./geo";

export interface WorldContext {
  locationsById: Map<LocationId, Location>;
  allLocations: Location[];
}

export function buildWorldContext(locations: Location[]): WorldContext {
  return { locationsById: new Map(locations.map((l) => [l.id, l])), allLocations: locations };
}

function travelModeFor(person: Person): TravelMode {
  return person.vehicle ? "car" : "foot";
}

interface MakeEventInput {
  timestamp: GameMinutes;
  durationMinutes: number;
  actorId: PersonId;
  locationId: LocationId;
  action: TimelineActionType;
  description: string;
  presentPersonIds?: PersonId[];
  counterpartyId?: PersonId | null;
  involvedObject?: string | null;
  observable?: boolean;
  evidenceSourceTags?: EvidenceSourceTag[];
  isCrimeEvent?: boolean;
}

export function makeEvent(rng: RNG, input: MakeEventInput): TimelineEvent {
  return {
    id: rng.id("evt"),
    timestamp: input.timestamp,
    durationMinutes: input.durationMinutes,
    actorId: input.actorId,
    locationId: input.locationId,
    action: input.action,
    description: input.description,
    presentPersonIds: input.presentPersonIds ?? [input.actorId],
    counterpartyId: input.counterpartyId ?? null,
    involvedObject: input.involvedObject ?? null,
    observable: input.observable ?? true,
    evidenceSourceTags: input.evidenceSourceTags ?? [],
    isCrimeEvent: input.isCrimeEvent ?? false,
  };
}

/**
 * Builds a "travel" event between two locations for a person, plus any
 * incidental waypoint sighting (camera/wifi) the route would plausibly pass.
 * Returns the arrival timestamp so callers can chain further events.
 */
export function travel(
  rng: RNG,
  world: WorldContext,
  person: Person,
  fromLocationId: LocationId,
  toLocationId: LocationId,
  departAt: GameMinutes,
): { events: TimelineEvent[]; arriveAt: GameMinutes } {
  const from = world.locationsById.get(fromLocationId);
  const to = world.locationsById.get(toLocationId);
  if (!from || !to) throw new Error("travel(): unknown location id");
  if (fromLocationId === toLocationId) {
    return { events: [], arriveAt: departAt };
  }

  const mode = travelModeFor(person);
  const duration = travelMinutes(from.coordinates, to.coordinates, mode);
  const arriveAt = departAt + duration;

  const tags: EvidenceSourceTag[] = ["phone_cell_tower"];
  if (mode === "car" && person.vehicle) tags.push("vehicle_sighting");

  const events: TimelineEvent[] = [
    makeEvent(rng, {
      timestamp: departAt,
      durationMinutes: duration,
      actorId: person.id,
      locationId: fromLocationId,
      action: "travel",
      description: `${person.firstName} ${person.lastName} se déplace de ${from.name} vers ${to.name} (${mode === "car" ? "en voiture" : "à pied"}).`,
      evidenceSourceTags: tags,
    }),
  ];

  const waypoint = findRouteWaypoint(
    from.coordinates,
    to.coordinates,
    world.allLocations.filter((l) => l.id !== fromLocationId && l.id !== toLocationId && (l.hasCameras || l.hasWifi)),
  );
  if (waypoint) {
    const waypointTags: EvidenceSourceTag[] = [];
    if (waypoint.hasCameras) waypointTags.push("camera");
    if (waypoint.hasWifi && rng.bool(0.4)) waypointTags.push("phone_wifi");
    if (mode === "car") waypointTags.push("vehicle_sighting");
    if (waypointTags.length > 0) {
      events.push(
        makeEvent(rng, {
          timestamp: departAt + Math.floor(duration / 2),
          durationMinutes: 1,
          actorId: person.id,
          locationId: waypoint.id,
          action: "other",
          description: `${person.firstName} ${person.lastName} passe à proximité de ${waypoint.name} en chemin.`,
          evidenceSourceTags: waypointTags,
        }),
      );
    }
  }

  return { events, arriveAt };
}

export interface BaselineResult {
  events: TimelineEvent[];
  arrivedHomeAt: GameMinutes;
}

/** Wake -> (commute -> work -> commute) -> arrive home. Stops there; the
 * evening is handled separately so the crime/interrogation logic can decide
 * what a specific person (victim, culprit) does after this point. */
export function generateDailyBaseline(rng: RNG, person: Person, world: WorldContext): BaselineResult {
  const wakeAt = hm(rng.int(6, 7), rng.int(0, 59));
  const events: TimelineEvent[] = [
    makeEvent(rng, {
      timestamp: wakeAt,
      durationMinutes: 15,
      actorId: person.id,
      locationId: person.homeLocationId,
      action: "wake_up",
      description: `${person.firstName} ${person.lastName} se réveille.`,
      observable: false,
    }),
  ];

  if (!person.workLocationId) {
    return { events, arrivedHomeAt: wakeAt + 15 };
  }

  const departForWorkAt = wakeAt + rng.int(45, 100);
  const toWork = travel(rng, world, person, person.homeLocationId, person.workLocationId, departForWorkAt);
  events.push(...toWork.events);

  const workDurationMinutes = rng.int(6, 9) * 60;
  events.push(
    makeEvent(rng, {
      timestamp: toWork.arriveAt,
      durationMinutes: workDurationMinutes,
      actorId: person.id,
      locationId: person.workLocationId,
      action: "work",
      description: `${person.firstName} ${person.lastName} travaille.`,
    }),
  );

  const leaveWorkAt = toWork.arriveAt + workDurationMinutes;
  const toHome = travel(rng, world, person, person.workLocationId, person.homeLocationId, leaveWorkAt);
  events.push(...toHome.events);

  return { events, arrivedHomeAt: toHome.arriveAt };
}

export interface EveningOptions {
  /** Do not schedule anything at or after this time (crime window reserved for this person). */
  reserveFrom?: GameMinutes;
}

export interface EveningResult {
  events: TimelineEvent[];
  /** The person id invited along as a companion, if any — the caller must
   * mark them unavailable so they aren't independently double-booked. */
  companionUsed: PersonId | null;
}

// Nobody's ordinary "evening out" starts before this, regardless of how early
// they got home (e.g. someone with no workplace) — otherwise a companion
// invitation could land in the middle of the morning.
const EARLIEST_EVENING_OUT = hm(17, 0);

/** An ordinary evening: stay in, or go out with someone they know. Used for
 * everyone who isn't the victim/culprit on the night of the crime — this is
 * what gives suspects and witnesses their alibis. `unavailableCompanions`
 * excludes people already claimed as someone else's companion this evening
 * (or who are the victim/culprit), so nobody ends up double-booked. */
export function generateEveningBlock(
  rng: RNG,
  person: Person,
  world: WorldContext,
  allPeople: Person[],
  relationships: Relationship[],
  homeArrivalAt: GameMinutes,
  options: EveningOptions = {},
  unavailableCompanions: ReadonlySet<PersonId> = new Set(),
  homeArrivalById: ReadonlyMap<PersonId, GameMinutes> = new Map(),
): EveningResult {
  const events: TimelineEvent[] = [];
  const reserveFrom = options.reserveFrom ?? Infinity;
  const goOutAt = Math.max(homeArrivalAt, EARLIEST_EVENING_OUT) + rng.int(30, 90);
  const graph = new RelationshipGraph(relationships);

  const companionCandidates: Person[] = graph
    .of(person.id)
    .filter((r) => ["friend", "spouse", "partner", "family"].includes(r.type))
    .map((r) => (r.from === person.id ? r.to : r.from))
    .map((id) => allPeople.find((p) => p.id === id))
    .filter((p): p is Person => p !== undefined && !unavailableCompanions.has(p.id))
    // A companion must already be free (home from their own day) by the time
    // this outing starts — otherwise they'd be double-booked with their own
    // baseline schedule.
    .filter((p: Person) => (homeArrivalById.get(p.id) ?? 0) <= goOutAt);

  const venues = world.allLocations.filter((l) => l.type === "restaurant" || l.type === "bar");
  const wantsToGoOut = venues.length > 0 && rng.bool(0.35) && goOutAt + 120 < reserveFrom;

  if (!wantsToGoOut) {
    const sleepAt = Math.min(homeArrivalAt + rng.int(120, 300), reserveFrom - 1);
    events.push(
      makeEvent(rng, {
        timestamp: Math.max(homeArrivalAt, sleepAt),
        durationMinutes: 480,
        actorId: person.id,
        locationId: person.homeLocationId,
        action: "sleep",
        description: `${person.firstName} ${person.lastName} passe la soirée chez soi.`,
        observable: false,
      }),
    );
    return { events, companionUsed: null };
  }

  const venue = rng.pick(venues);
  const companion = companionCandidates.length > 0 && rng.bool(0.6) ? rng.pick(companionCandidates) : null;

  const toVenue = travel(rng, world, person, person.homeLocationId, venue.id, goOutAt);
  events.push(...toVenue.events);

  const visitDuration = rng.int(60, 110);
  events.push(
    makeEvent(rng, {
      timestamp: toVenue.arriveAt,
      durationMinutes: visitDuration,
      actorId: person.id,
      locationId: venue.id,
      action: "meet",
      description: companion
        ? `${person.firstName} ${person.lastName} retrouve ${companion.firstName} ${companion.lastName} à ${venue.name}.`
        : `${person.firstName} ${person.lastName} passe un moment à ${venue.name}.`,
      presentPersonIds: companion ? [person.id, companion.id] : [person.id],
      counterpartyId: companion?.id ?? null,
      evidenceSourceTags: ["card_payment"],
    }),
  );

  const leaveVenueAt = toVenue.arriveAt + visitDuration;
  const backHome = travel(rng, world, person, venue.id, person.homeLocationId, leaveVenueAt);
  events.push(...backHome.events);

  events.push(
    makeEvent(rng, {
      timestamp: backHome.arriveAt,
      durationMinutes: 480,
      actorId: person.id,
      locationId: person.homeLocationId,
      action: "sleep",
      description: `${person.firstName} ${person.lastName} rentre se coucher.`,
      observable: false,
    }),
  );

  return { events, companionUsed: companion?.id ?? null };
}
