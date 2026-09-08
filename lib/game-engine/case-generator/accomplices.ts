import type { RNG } from "../random/rng";
import type { Person, PersonId } from "../types/person";
import { fullName } from "../types/person";
import type { Relationship } from "../types/relationship";
import { RelationshipGraph } from "../types/relationship";
import type { GameMinutes } from "../types/time";
import type { TimelineEvent } from "../types/timeline";
import type { Accomplice, AccompliceRole } from "../types/case";
import type { ArchetypePolicy } from "./archetype";
import type { DifficultyConfig } from "./difficulty";
import { buildWorldContext, currentLocationAt, ensureAtLocation, makeEvent } from "../simulation/schedule";
import { clearWindowForPerson } from "../simulation/timeline-engine";
import type { Location } from "../types/location";

const ALL_ROLES: AccompliceRole[] = ["planner", "lookout", "driver", "evidence_disposal", "false_alibi_provider"];

const ROLE_KNOWS_PLAN_CHANCE: Record<AccompliceRole, number> = {
  planner: 1,
  lookout: 0.35,
  driver: 0.35,
  evidence_disposal: 0.5,
  false_alibi_provider: 0.3,
};

const ROLE_DESCRIPTION: Record<AccompliceRole, (culprit: Person, accomplice: Person) => string> = {
  planner: (c, a) => `${fullName(a)} a aidé ${fullName(c)} à préparer le passage à l'acte.`,
  lookout: (c, a) => `${fullName(a)} faisait le guet à proximité pendant les faits.`,
  driver: (c, a) => `${fullName(a)} a conduit ${fullName(c)} depuis ou vers les lieux.`,
  evidence_disposal: (c, a) => `${fullName(a)} s'est chargé·e de faire disparaître des éléments compromettants après les faits.`,
  false_alibi_provider: (c, a) => `${fullName(a)} a accepté de couvrir ${fullName(c)} en confirmant un faux alibi.`,
};

/** 0, 1, or (rarely) 2 accomplices, weighted by difficulty and nudged by the
 * archetype (a workplace conspiracy is far more likely to involve a second
 * party than a crime of opportunity is). */
export function decideAccompliceCount(rng: RNG, config: DifficultyConfig, policy: ArchetypePolicy): 0 | 1 | 2 {
  const weights = config.accompliceChance;
  const scaledOne = weights.one * policy.accompliceChanceMultiplier;
  const scaledTwo = weights.two * policy.accompliceChanceMultiplier;
  return rng.pickWeighted<0 | 1 | 2>([
    { item: 0, weight: weights.none },
    { item: 1, weight: scaledOne },
    { item: 2, weight: scaledTwo },
  ]);
}

function candidatePool(culprit: Person, victim: Person, people: Person[], relationships: Relationship[]): Person[] {
  const graph = new RelationshipGraph(relationships);
  const seen = new Set<PersonId>();
  const pool: Person[] = [];
  for (const rel of graph.of(culprit.id)) {
    if (!["friend", "family", "spouse", "partner", "colleague"].includes(rel.type)) continue;
    const otherId = rel.from === culprit.id ? rel.to : rel.from;
    if (otherId === victim.id || seen.has(otherId)) continue;
    const bond = rel.attributes.trust + rel.attributes.affection + rel.attributes.dependency * 0.5;
    if (bond < 0.7) continue;
    const person = people.find((p) => p.id === otherId);
    if (person) {
      seen.add(otherId);
      pool.push(person);
    }
  }
  return pool;
}

/** Everything `coordinated-alibi.ts` needs to turn a real, innocent meeting
 * into a deliberate, coordinated lie: the event both parties genuinely
 * shared, and the location/window it actually covered (before any lie
 * stretches it out to reach the crime). */
export interface FalseAlibiMeeting {
  accompliceId: PersonId;
  meetingEventId: string;
  locationId: string;
  realWindowStart: GameMinutes;
  realWindowEnd: GameMinutes;
}

export interface AccompliceGenerationResult {
  accomplices: Accomplice[];
  timelineEvents: TimelineEvent[];
  falseAlibiMeeting: FalseAlibiMeeting | null;
}

/**
 * Picks accomplices from the culprit's closest circle and grafts one
 * role-appropriate TimelineEvent per accomplice onto the timeline — always
 * clearing whatever ordinary evening was previously scheduled for them so
 * no "present in two places" contradiction can result. An accomplice who
 * doesn't know the full plan is never made present at the crime event
 * itself, only at their own narrow slice of it.
 */
export function generateAccomplices(
  rng: RNG,
  culprit: Person,
  victim: Person,
  people: Person[],
  locations: Location[],
  relationships: Relationship[],
  crimeLocationId: string,
  crimeTimestamp: GameMinutes,
  count: 0 | 1 | 2,
  existingTimeline: TimelineEvent[],
): AccompliceGenerationResult {
  if (count === 0) return { accomplices: [], timelineEvents: existingTimeline, falseAlibiMeeting: null };

  const pool = candidatePool(culprit, victim, people, relationships);
  if (pool.length === 0) return { accomplices: [], timelineEvents: existingTimeline, falseAlibiMeeting: null };

  const chosen = rng.sample(pool, Math.min(count, pool.length));
  const roles = rng.sample(ALL_ROLES, Math.min(chosen.length, ALL_ROLES.length));
  const world = buildWorldContext(locations);

  let timeline = [...existingTimeline];
  const accomplices: Accomplice[] = [];
  let falseAlibiMeeting: FalseAlibiMeeting | null = null;

  chosen.forEach((accomplicePerson, i) => {
    const role = roles[i] ?? rng.pick(ALL_ROLES);
    const accRng = rng.derive(`accomplice-${accomplicePerson.id}`);
    const knowsFullPlan = accRng.bool(ROLE_KNOWS_PLAN_CHANCE[role]);

    // Generous pad so a travel leg inserted after clearing always has room
    // to land before the window closes, regardless of real distance.
    const TRAVEL_PAD = 60;
    let event: TimelineEvent;

    if (role === "false_alibi_provider" || role === "planner") {
      // A genuine meeting well *before* the crime window (never anywhere
      // near the culprit's actual lure/travel/attack sequence), held at the
      // accomplice's home. Both parties' locations are read *before* any
      // clearing happens — clearing removes the very event this needs to
      // inspect.
      const start = crimeTimestamp - accRng.int(300, 600);
      const duration = accRng.int(20, 60);
      const culpritOrigin = currentLocationAt(timeline, culprit, start);
      const meetLocationId = accomplicePerson.homeLocationId;

      timeline = clearWindowForPerson(timeline, culprit.id, start, start + duration + TRAVEL_PAD);
      timeline = clearWindowForPerson(timeline, accomplicePerson.id, start, start + duration + TRAVEL_PAD);

      const culpritTrip = ensureAtLocation(accRng, world, culprit, culpritOrigin, meetLocationId, start);
      timeline = [...timeline, ...culpritTrip.events];

      const description =
        role === "false_alibi_provider"
          ? `${fullName(culprit)} retrouve ${fullName(accomplicePerson)} chez lui/elle, bien avant les faits.`
          : `${fullName(culprit)} et ${fullName(accomplicePerson)} préparent le passage à l'acte.`;
      event = makeEvent(accRng, {
        timestamp: culpritTrip.arriveAt,
        durationMinutes: duration,
        actorId: culprit.id,
        locationId: meetLocationId,
        action: "meet",
        description,
        presentPersonIds: [culprit.id, accomplicePerson.id],
        counterpartyId: accomplicePerson.id,
      });
      if (role === "false_alibi_provider") {
        falseAlibiMeeting = {
          accompliceId: accomplicePerson.id,
          meetingEventId: event.id,
          locationId: meetLocationId,
          realWindowStart: event.timestamp,
          realWindowEnd: event.timestamp + duration,
        };
      }
    } else if (role === "driver") {
      const departAt = crimeTimestamp - accRng.int(20, 40);
      const origin = currentLocationAt(timeline, accomplicePerson, departAt);
      timeline = clearWindowForPerson(timeline, accomplicePerson.id, departAt, departAt + TRAVEL_PAD + 5);
      const trip = ensureAtLocation(accRng, world, accomplicePerson, origin, crimeLocationId, departAt);
      timeline = [...timeline, ...trip.events];
      // Never places the culprit in this event's presentPersonIds: it lands
      // inside the culprit's own crime-night sequence, which must not be
      // truncated. "Knows the full plan" is established via the planner/
      // false-alibi meeting instead, not by a shared timeline event here.
      event = makeEvent(accRng, {
        timestamp: trip.arriveAt,
        durationMinutes: 5,
        actorId: accomplicePerson.id,
        locationId: crimeLocationId,
        action: "other",
        description: `${fullName(accomplicePerson)} attend au volant à proximité de la scène.`,
        presentPersonIds: [accomplicePerson.id],
      });
    } else if (role === "lookout") {
      const start = crimeTimestamp - accRng.int(10, 25);
      const duration = accRng.int(15, 30);
      const origin = currentLocationAt(timeline, accomplicePerson, start);
      timeline = clearWindowForPerson(timeline, accomplicePerson.id, start, start + duration + TRAVEL_PAD);
      const trip = ensureAtLocation(accRng, world, accomplicePerson, origin, crimeLocationId, start);
      timeline = [...timeline, ...trip.events];
      event = makeEvent(accRng, {
        timestamp: trip.arriveAt,
        durationMinutes: duration,
        actorId: accomplicePerson.id,
        locationId: crimeLocationId,
        action: "observe",
        description: `${fullName(accomplicePerson)} surveille les abords pendant les faits.`,
        presentPersonIds: [accomplicePerson.id],
      });
    } else {
      // evidence_disposal
      const start = crimeTimestamp + accRng.int(15, 45);
      const duration = accRng.int(10, 20);
      const origin = currentLocationAt(timeline, accomplicePerson, start);
      timeline = clearWindowForPerson(timeline, accomplicePerson.id, start, start + duration + TRAVEL_PAD);
      const trip = ensureAtLocation(accRng, world, accomplicePerson, origin, crimeLocationId, start);
      timeline = [...timeline, ...trip.events];
      // Same reasoning as "driver" above: this window sits right after the
      // attack, inside the culprit's own flee/return sequence, so the
      // culprit is deliberately left out of presentPersonIds here.
      event = makeEvent(accRng, {
        timestamp: trip.arriveAt,
        durationMinutes: duration,
        actorId: accomplicePerson.id,
        locationId: crimeLocationId,
        action: "destroy_evidence",
        description: `${fullName(accomplicePerson)} revient discrètement sur les lieux pour faire disparaître des éléments.`,
        presentPersonIds: [accomplicePerson.id],
      });
    }

    timeline = [...timeline, event];
    accomplices.push({
      personId: accomplicePerson.id,
      role,
      knowsFullPlan,
      involvementDescription: ROLE_DESCRIPTION[role](culprit, accomplicePerson),
    });
  });

  // `timeline` already reflects every window-clearing and every new event
  // for every accomplice processed so far, each iteration building on the
  // last — so a later accomplice's window-clearing can see and correctly
  // truncate an earlier accomplice's newly inserted event too.
  return { accomplices, timelineEvents: timeline, falseAlibiMeeting };
}
