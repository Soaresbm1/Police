import type { RNG } from "../random/rng";
import type { Person, PersonId } from "../types/person";
import type { Location, LocationId } from "../types/location";
import { travelMinutes } from "../types/location";
import type { Relationship } from "../types/relationship";
import { RelationshipGraph } from "../types/relationship";
import type { AutopsyReport } from "../types/case";
import type { GameMinutes } from "../types/time";
import { Timeline, type TimelineEvent } from "../types/timeline";
import type { MotiveCandidate } from "../case-generator/motive";
import type { ArchetypePolicy } from "../case-generator/archetype";
import type { CrimeMethod } from "../types/case";
import { buildWorldContext, generateDailyBaseline, generateEveningBlock, makeEvent, travel } from "./schedule";
import { planCrime, type CrimePlan } from "./crime-planner";

/**
 * Removes/truncates whatever a person's existing schedule says they were
 * doing during `[windowStart, windowEnd)`, so a caller can insert a new
 * stationary event for them there without ever creating a "present in two
 * places at once" contradiction. Mirrors the discoverer-window logic below —
 * shared here so every module that grafts an extra event onto an ordinary
 * person's evening (accomplice role events, staging, tampering) gets the
 * same guarantee. Mutates nothing; returns the filtered array.
 */
export function clearWindowForPerson(
  timeline: TimelineEvent[],
  personId: PersonId,
  windowStart: GameMinutes,
  windowEnd: GameMinutes,
): TimelineEvent[] {
  const survivors: TimelineEvent[] = [];
  for (const ev of timeline) {
    const involves = ev.actorId === personId || ev.presentPersonIds.includes(personId);
    const overlaps = ev.timestamp < windowEnd && ev.timestamp + ev.durationMinutes > windowStart;
    if (involves && overlaps) {
      if (ev.timestamp >= windowStart) continue; // starts inside the window: drop entirely
      survivors.push({ ...ev, durationMinutes: Math.max(1, windowStart - ev.timestamp) });
      continue;
    }
    survivors.push(ev);
  }
  return survivors;
}

export interface SimulationResult {
  timeline: TimelineEvent[];
  crimeLocationId: LocationId;
  crimeTimestamp: GameMinutes;
  caseOpenedAt: GameMinutes;
  weapon: string;
  method: string;
  methodType: CrimeMethod;
  premeditated: boolean;
  autopsy: AutopsyReport;
}

function pickDiscoverer(victim: Person, culprit: Person, people: Person[], relationships: Relationship[], rng: RNG): Person {
  const graph = new RelationshipGraph(relationships);
  const candidates = graph
    .of(victim.id)
    .filter((r) => r.from !== culprit.id && r.to !== culprit.id)
    .map((r) => (r.from === victim.id ? r.to : r.from))
    .map((id) => people.find((p) => p.id === id))
    .filter((p): p is Person => Boolean(p))
    .filter((p) => p.id !== culprit.id);

  if (candidates.length > 0) return rng.pick(candidates);
  const fallback = people.filter((p) => p.id !== victim.id && p.id !== culprit.id);
  return rng.pick(fallback);
}

export function simulateCaseDay(
  rng: RNG,
  people: Person[],
  locations: Location[],
  relationships: Relationship[],
  victim: Person,
  culprit: Person,
  motive: MotiveCandidate,
  archetype: ArchetypePolicy,
): SimulationResult {
  const world = buildWorldContext(locations);
  const timeline: TimelineEvent[] = [];
  const homeArrivalById = new Map<PersonId, number>();

  for (const person of people) {
    const baseline = generateDailyBaseline(rng.derive(`baseline-${person.id}`), person, world);
    timeline.push(...baseline.events);
    homeArrivalById.set(person.id, baseline.arrivedHomeAt);
  }

  const neutralCandidates = locations.filter((l) => l.type === "park" || l.type === "warehouse" || l.type === "parking");
  const crimePlan: CrimePlan = planCrime(rng.derive("crime-plan"), culprit, motive, victim, neutralCandidates, archetype);

  const culpritHomeArrival = homeArrivalById.get(culprit.id) ?? 18 * 60;
  const victimHomeArrival = homeArrivalById.get(victim.id) ?? 18 * 60;

  // Everyone except the victim and culprit gets an ordinary, independent
  // evening. `processed` prevents anyone from being double-booked: a person
  // can only be invited as someone else's companion before their own turn in
  // this loop comes up (after which they'd already have an independent
  // evening committed to the timeline).
  const processed = new Set<PersonId>([victim.id, culprit.id]);
  for (const person of people) {
    if (processed.has(person.id)) continue;
    processed.add(person.id);
    const arrival = homeArrivalById.get(person.id) ?? 18 * 60;
    const evening = generateEveningBlock(
      rng.derive(`evening-${person.id}`),
      person,
      world,
      people,
      relationships,
      arrival,
      {},
      processed,
      homeArrivalById,
    );
    timeline.push(...evening.events);
    if (evening.companionUsed) processed.add(evening.companionUsed);
  }

  const crimeRng = rng.derive("crime-sequence");
  const needsCulpritTravel = crimePlan.crimeLocationId !== culprit.homeLocationId;
  const needsVictimTravel = crimePlan.crimeLocationId !== victim.homeLocationId;

  // The whole pre-crime sequence is built as a strictly forward-moving
  // schedule: each step is placed after the previous one actually finishes,
  // for each of the two people involved, and the crime itself is timed off
  // of when both are *actually* ready — never the other way around. This is
  // what guarantees the sequence can never require someone to be in two
  // places at once, however the random rolls land.
  let culpritCursor = culpritHomeArrival + crimeRng.int(30, 90);
  let victimCursor = victimHomeArrival;

  // Premeditation: a preparatory purchase, occasionally paid by card (a mistake).
  if (crimePlan.premeditated) {
    const shop = locations.find((l) => l.type === "shop");
    if (shop) {
      const prepTime = culpritCursor;
      const paidByCard = crimeRng.bool(0.5);
      timeline.push(
        makeEvent(crimeRng, {
          timestamp: prepTime,
          durationMinutes: 10,
          actorId: culprit.id,
          locationId: shop.id,
          action: "purchase",
          description: `${culprit.firstName} ${culprit.lastName} achète du matériel (gants, sac) en prévision de son geste.`,
          evidenceSourceTags: paidByCard ? ["card_payment", "camera"] : ["camera"],
        }),
      );
      culpritCursor = prepTime + 10 + crimeRng.int(15, 45);
    }
  }

  // Lure: if the victim needs to travel to the meeting point, the culprit contacts them first.
  if (needsVictimTravel) {
    const lureAt = culpritCursor;
    const byCall = crimeRng.bool(0.5);
    timeline.push(
      makeEvent(crimeRng, {
        timestamp: lureAt,
        durationMinutes: 2,
        actorId: culprit.id,
        locationId: culprit.homeLocationId,
        action: byCall ? "phone_call" : "send_message",
        description: `${culprit.firstName} ${culprit.lastName} contacte ${victim.firstName} ${victim.lastName} pour lui donner rendez-vous.`,
        presentPersonIds: [culprit.id],
        counterpartyId: victim.id,
        evidenceSourceTags: [byCall ? "call_record" : "sms_record"],
        observable: false,
      }),
    );
    culpritCursor = lureAt + 2;

    const victimDepartAt = Math.max(victimCursor, lureAt + crimeRng.int(10, 30));
    const victimTrip = travel(crimeRng, world, victim, victim.homeLocationId, crimePlan.crimeLocationId, victimDepartAt);
    timeline.push(...victimTrip.events);
    victimCursor = victimTrip.arriveAt;
  }

  if (needsCulpritTravel) {
    const culpritDepartAt = culpritCursor + crimeRng.int(5, 20);
    const culpritTrip = travel(crimeRng, world, culprit, culprit.homeLocationId, crimePlan.crimeLocationId, culpritDepartAt);
    timeline.push(...culpritTrip.events);
    culpritCursor = culpritTrip.arriveAt;
  }

  // The confrontation can only start once both of them have actually arrived.
  const meetingStart = Math.max(culpritCursor, victimCursor) + crimeRng.int(2, 10);
  const argumentDuration = crimeRng.int(5, 15);
  timeline.push(
    makeEvent(crimeRng, {
      timestamp: meetingStart,
      durationMinutes: argumentDuration,
      actorId: culprit.id,
      locationId: crimePlan.crimeLocationId,
      action: "argument",
      description: `Une dispute éclate entre ${culprit.firstName} ${culprit.lastName} et ${victim.firstName} ${victim.lastName}.`,
      presentPersonIds: [culprit.id, victim.id],
      counterpartyId: victim.id,
      evidenceSourceTags: ["witness_sightline"],
    }),
  );

  const crimeTimestamp = meetingStart + argumentDuration;
  timeline.push(
    makeEvent(crimeRng, {
      timestamp: crimeTimestamp,
      durationMinutes: 3,
      actorId: culprit.id,
      locationId: crimePlan.crimeLocationId,
      action: "attack",
      description: crimePlan.methodProfile.method,
      presentPersonIds: [culprit.id, victim.id],
      counterpartyId: victim.id,
      involvedObject: crimePlan.methodProfile.weapon,
      evidenceSourceTags: crimePlan.methodProfile.physicalTags,
      isCrimeEvent: true,
    }),
  );

  const fleeAt = crimeTimestamp + crimeRng.int(3, 10);
  const fleeTrip = travel(crimeRng, world, culprit, crimePlan.crimeLocationId, culprit.homeLocationId, fleeAt);
  timeline.push(...fleeTrip.events);
  timeline.push(
    makeEvent(crimeRng, {
      timestamp: fleeTrip.arriveAt,
      durationMinutes: 480,
      actorId: culprit.id,
      locationId: culprit.homeLocationId,
      action: "sleep",
      description: `${culprit.firstName} ${culprit.lastName} rentre chez lui/elle pour la nuit.`,
      observable: false,
    }),
  );

  const discoverer = pickDiscoverer(victim, culprit, people, relationships, crimeRng);
  const discoveryAt = crimeTimestamp + crimeRng.int(9 * 60, 14 * 60);
  const discoveryDepartAt = discoveryAt - 10;
  const OBSERVE_DURATION = 10;

  // The discoverer isn't necessarily home when the call comes — if their own
  // evening is still going (e.g. dinner ran late), the discovery trip must
  // start from wherever they actually are, not teleport them home first.
  const discovererLocationAtDeparture =
    new Timeline(timeline).at(discoverer.id, discoveryDepartAt)?.locationId ?? discoverer.homeLocationId;

  const discoveryTrip = travel(
    crimeRng,
    world,
    discoverer,
    discovererLocationAtDeparture,
    crimePlan.crimeLocationId,
    discoveryDepartAt,
  );
  // The window must also cover the discoverer's trip back home afterward —
  // any leftover event from their original evening that would otherwise
  // start right as they leave the scene needs to be pushed out too.
  const crimeSceneLocation = world.locationsById.get(crimePlan.crimeLocationId);
  const discovererHome = world.locationsById.get(discoverer.homeLocationId);
  const returnTravelMinutes =
    crimeSceneLocation && discovererHome
      ? travelMinutes(crimeSceneLocation.coordinates, discovererHome.coordinates, "car")
      : 0;
  const discoveryWindowEnd = discoveryTrip.arriveAt + OBSERVE_DURATION + returnTravelMinutes;

  // The discoverer may have had an ordinary evening activity (sleeping,
  // dining out...) scheduled to overlap the moment they get called away to
  // find the body (and the time it takes to do so) — being interrupted is
  // always possible, so clear out whatever conflicts with that window rather
  // than flag a false teleportation/overlap. Events that start inside the
  // window are dropped outright; events already running are truncated to end
  // at departure.
  const survivors: TimelineEvent[] = [];
  for (const ev of timeline) {
    const involvesDiscoverer = ev.actorId === discoverer.id || ev.presentPersonIds.includes(discoverer.id);
    const overlapsWindow = ev.timestamp < discoveryWindowEnd && ev.timestamp + ev.durationMinutes > discoveryDepartAt;
    if (involvesDiscoverer && overlapsWindow) {
      if (ev.timestamp >= discoveryDepartAt) continue; // starts inside the window: drop entirely
      ev.durationMinutes = Math.max(1, discoveryDepartAt - ev.timestamp);
    }
    survivors.push(ev);
  }
  timeline.length = 0;
  timeline.push(...survivors);

  timeline.push(...discoveryTrip.events);
  timeline.push(
    makeEvent(crimeRng, {
      timestamp: discoveryTrip.arriveAt,
      durationMinutes: OBSERVE_DURATION,
      actorId: discoverer.id,
      locationId: crimePlan.crimeLocationId,
      action: "observe",
      description: `${discoverer.firstName} ${discoverer.lastName} découvre le corps de ${victim.firstName} ${victim.lastName} et alerte la police.`,
      presentPersonIds: [discoverer.id],
    }),
  );

  const deathWindowStart = crimeTimestamp - crimeRng.int(15, 30);
  const deathWindowEnd = crimeTimestamp + crimeRng.int(15, 45);
  const hadAlcohol = crimeRng.bool(0.2);
  const struggle = argumentDuration >= 10;

  const autopsy: AutopsyReport = {
    estimatedDeathWindowStart: deathWindowStart,
    estimatedDeathWindowEnd: deathWindowEnd,
    causeOfDeath: crimePlan.methodProfile.causeOfDeath,
    weaponType: crimePlan.methodProfile.weapon,
    wounds: crimePlan.methodProfile.wounds,
    substancesFound: hadAlcohol ? ["alcool (taux modéré)"] : [],
    bodyPosition: crimeRng.pick(["allongé sur le dos", "allongé sur le ventre", "recroquevillé", "assis contre un mur"]),
    notableFeatures: [
      ...(struggle ? ["signes de lutte visibles"] : []),
      crimeRng.pick(crimePlan.methodProfile.forensicNotes),
    ],
  };

  return {
    timeline,
    crimeLocationId: crimePlan.crimeLocationId,
    crimeTimestamp,
    caseOpenedAt: discoveryTrip.arriveAt,
    weapon: crimePlan.methodProfile.weapon,
    method: crimePlan.methodProfile.method,
    methodType: crimePlan.methodProfile.methodType,
    premeditated: crimePlan.premeditated,
    autopsy,
  };
}
