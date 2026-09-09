import { createRootRng } from "../random/rng";
import type { CaseSeed, CaseTruth, Difficulty, Motive } from "../types/case";
import type { Person, PersonId } from "../types/person";
import { Timeline } from "../types/timeline";
import { generateTownInfrastructure } from "../world/world-generator";
import { generatePopulation } from "./population";
import { generateRelationships } from "./relationships";
import { deriveMotiveCandidates, pickCulprit, selectVictim, toMotive, type MotiveCandidate } from "./motive";
import { simulateCaseDay } from "../simulation/timeline-engine";
import { deriveEvidenceFromTimeline, generateRedHerrings } from "../evidence/evidence-generator";
import { buildKnowledgeGraph, propagateSecondHandKnowledge } from "../witness/knowledge-graph";
import { generateTestimony } from "../witness/testimony-generator";
import { buildAlibis } from "./alibis";
import { DIFFICULTY_CONFIGS } from "./difficulty";
import { pickArchetype } from "./archetype";
import { applyArchetypeStoryBias } from "./archetype-bias";
import { CRIME_METHOD_PROFILES } from "../simulation/crime-methods";
import { decideAccompliceCount, generateAccomplices } from "./accomplices";
import { decideStaging, applyStaging } from "./staging";
import { decideTamperingActions, applyTampering } from "./tampering";
import { generateSharedResources, applySharedResourceAmbiguity } from "./shared-resources";
import { decideFalseConfession, buildFalseConfession } from "./false-confession";
import { applyCoordinatedFalseAlibi } from "./coordinated-alibi";
import { generatePostCrimeMovements, type PostCrimeSubject } from "../simulation/post-crime-observation";

function dedupeCandidatesByHolder(candidates: MotiveCandidate[]): MotiveCandidate[] {
  const seen = new Set<PersonId>();
  const result: MotiveCandidate[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.holderId)) continue;
    seen.add(candidate.holderId);
    result.push(candidate);
  }
  return result;
}

/** Groups every raw candidate (including secondary ones a single holder may
 * have, e.g. a direct grudge *and* an affair-triangle motive) by holder, so
 * a suspect — including, sometimes, the culprit — can show up with more
 * than one credible motive. Motive alone never identifies the culprit: this
 * is what lets several suspects look equally suspicious on paper. */
function groupMotivesByHolder(candidates: MotiveCandidate[], relevantIds: Set<PersonId>): Record<PersonId, Motive[]> {
  const grouped: Record<PersonId, Motive[]> = {};
  for (const candidate of candidates) {
    if (!relevantIds.has(candidate.holderId)) continue;
    const list = grouped[candidate.holderId] ?? [];
    list.push(toMotive(candidate));
    grouped[candidate.holderId] = list;
  }
  return grouped;
}

export interface GenerateCaseOptions {
  difficulty?: Difficulty;
}

export function generateCase(seed: CaseSeed, options: GenerateCaseOptions = {}): CaseTruth {
  const difficulty = options.difficulty ?? "investigator";
  const config = DIFFICULTY_CONFIGS[difficulty];
  const rootRng = createRootRng(seed);
  const archetype = pickArchetype(rootRng.derive("archetype"), difficulty);

  const infrastructure = generateTownInfrastructure(rootRng.derive("infrastructure"));
  const population = generatePopulation(rootRng.derive("population"), infrastructure, {
    suspectCount: config.suspectCount,
    witnessCount: config.witnessCount,
  });
  const people = population.people;
  const locations = [...infrastructure, ...population.homeLocations];

  const baseRelationships = generateRelationships(rootRng.derive("relationships"), people, locations);
  // Guarantees the graph actually supports the chosen archetype (a strong,
  // correctly-typed relationship with attributes tuned to trip the matching
  // motive branch) rather than the archetype only ever being a label
  // attached after generation — see archetype-bias.ts.
  const relationships = applyArchetypeStoryBias(rootRng.derive("archetype-bias"), archetype, people, locations, baseRelationships);

  const victim = selectVictim(rootRng.derive("victim"), people, relationships, archetype);
  const rawCandidates = deriveMotiveCandidates(victim, people, relationships);
  if (rawCandidates.length === 0) {
    throw new Error(`generateCase(${seed}): no viable motive candidates for the selected victim`);
  }
  const candidates = dedupeCandidatesByHolder(rawCandidates);

  const culpritCandidate = pickCulprit(rootRng.derive("culprit"), candidates, relationships, archetype);
  const culprit = people.find((p) => p.id === culpritCandidate.holderId);
  if (!culprit) throw new Error(`generateCase(${seed}): culprit resolution failed`);
  const motive = toMotive(culpritCandidate);

  const simulation = simulateCaseDay(
    rootRng.derive("simulation"),
    people,
    locations,
    relationships,
    victim,
    culprit,
    culpritCandidate,
    archetype,
  );

  const otherCandidates = candidates.filter((c) => c.holderId !== culprit.id);
  const suspectPickRng = rootRng.derive("suspect-pool");
  const suspects: Person[] = [culprit];
  for (const candidate of otherCandidates) {
    if (suspects.length >= config.suspectCount) break;
    const person = people.find((p) => p.id === candidate.holderId);
    if (person) suspects.push(person);
  }
  if (suspects.length < config.suspectCount) {
    const remainingPool = people.filter((p) => p.id !== victim.id && !suspects.some((s) => s.id === p.id));
    const filler = suspectPickRng.sample(remainingPool, Math.min(config.suspectCount - suspects.length, remainingPool.length));
    suspects.push(...filler);
  }

  // --- Accomplices --------------------------------------------------------
  const accompliceCount = decideAccompliceCount(rootRng.derive("accomplice-count"), config, archetype);
  const accompliceResult = generateAccomplices(
    rootRng.derive("accomplices"),
    culprit,
    victim,
    people,
    locations,
    relationships,
    simulation.crimeLocationId,
    simulation.crimeTimestamp,
    accompliceCount,
    simulation.timeline,
  );
  let workingTimeline = accompliceResult.timelineEvents;

  // Accomplices are suspects too, for investigation purposes — no separate
  // UI surface needed, they simply join the interrogatable pool.
  const suspectIdSet = new Set(suspects.map((s) => s.id));
  for (const acc of accompliceResult.accomplices) {
    if (suspectIdSet.has(acc.personId)) continue;
    const person = people.find((p) => p.id === acc.personId);
    if (person) {
      suspects.push(person);
      suspectIdSet.add(acc.personId);
    }
  }

  // --- Staging -------------------------------------------------------------
  const methodProfile = CRIME_METHOD_PROFILES[simulation.methodType];
  const stagingType = decideStaging(rootRng.derive("staging-decision"), config, archetype, methodProfile);
  const stagingApplication = applyStaging(
    rootRng.derive("staging"),
    stagingType,
    culprit,
    victim,
    simulation.crimeLocationId,
    simulation.crimeTimestamp,
    methodProfile,
    locations,
    workingTimeline,
  );
  workingTimeline = stagingApplication.events;

  // --- Evidence (timeline-derived + red herrings + staging tells) ---------
  const evidenceFromTimeline = deriveEvidenceFromTimeline(rootRng.derive("evidence"), workingTimeline, people, locations, {
    caseOpenedAt: simulation.caseOpenedAt,
    crimeTimestamp: simulation.crimeTimestamp,
    contaminationChance: config.contaminationChance,
  });

  const redHerringPeople = otherCandidates
    .filter((c) => c.holderId !== culprit.id)
    .slice(0, config.redHerringCount)
    .map((c) => people.find((p) => p.id === c.holderId))
    .filter((p): p is Person => Boolean(p));

  const redHerrings = generateRedHerrings(
    rootRng.derive("red-herrings"),
    redHerringPeople,
    locations,
    { caseOpenedAt: simulation.caseOpenedAt, crimeTimestamp: simulation.crimeTimestamp },
    config.redHerringCount,
  );

  let evidence = [...evidenceFromTimeline, ...redHerrings, ...stagingApplication.evidence];

  // --- Deliberate tampering -------------------------------------------------
  const disposalAccomplice = accompliceResult.accomplices.find((a) => a.role === "evidence_disposal");
  const tamperingActor = disposalAccomplice ? (people.find((p) => p.id === disposalAccomplice.personId) ?? culprit) : culprit;
  const tamperingActions = decideTamperingActions(rootRng.derive("tampering-decision"), config, archetype);
  const tamperingApplication = applyTampering(
    rootRng.derive("tampering"),
    tamperingActions,
    tamperingActor,
    victim,
    simulation.crimeLocationId,
    simulation.crimeTimestamp,
    locations,
    workingTimeline,
    evidence,
  );
  workingTimeline = tamperingApplication.timeline;
  evidence = tamperingApplication.evidence;

  // Defensive cleanup: a later window-clearing pass (accomplice, staging, or
  // tampering) can truncate away an event that evidence generated earlier in
  // the pipeline already pointed to. Rather than rely on every module
  // perfectly avoiding that overlap, drop any evidence left dangling —
  // losing an occasional minor clue is far preferable to a "references a
  // nonexistent event" validator error.
  {
    const liveEventIds = new Set(workingTimeline.map((e) => e.id));
    evidence = evidence.filter((e) => e.sourceEventId === null || liveEventIds.has(e.sourceEventId));
  }

  // --- Shared devices/accounts ---------------------------------------------
  const sharedResources = generateSharedResources(rootRng.derive("shared-resources"), people, relationships);
  evidence = applySharedResourceAmbiguity(evidence, sharedResources);

  // --- Knowledge & testimony (built from the FINAL timeline) ---------------
  const directKnowledge = buildKnowledgeGraph(rootRng.derive("knowledge"), workingTimeline, people, locations, relationships);
  const secondHandKnowledge = propagateSecondHandKnowledge(
    rootRng.derive("gossip"),
    directKnowledge,
    people,
    relationships,
    simulation.caseOpenedAt,
  );
  const knowledge = [...directKnowledge, ...secondHandKnowledge];

  const finalTimeline = new Timeline(workingTimeline);
  let alibis = buildAlibis(rootRng.derive("alibis"), suspects, culprit.id, simulation.crimeTimestamp, finalTimeline, locations, evidence);

  let testimony = generateTestimony(rootRng.derive("testimony"), knowledge, workingTimeline, relationships, culprit.id, alibis);

  // --- Coordinated false alibi (false_alibi_provider accomplice) -----------
  if (accompliceResult.falseAlibiMeeting) {
    const accomplicePerson = people.find((p) => p.id === accompliceResult.falseAlibiMeeting!.accompliceId);
    if (accomplicePerson) {
      const patched = applyCoordinatedFalseAlibi(
        accompliceResult.falseAlibiMeeting,
        culprit,
        accomplicePerson,
        simulation.crimeTimestamp,
        alibis,
        testimony,
        knowledge,
        evidence,
      );
      alibis = patched.alibis;
      testimony = patched.testimony;
    }
  }

  // --- False confession ------------------------------------------------------
  const falseConfession = decideFalseConfession(rootRng.derive("false-confession-decision"), config.falseConfessionChance)
    ? buildFalseConfession(
        rootRng.derive("false-confession"),
        culprit,
        victim,
        suspects,
        relationships,
        alibis,
        evidence,
        simulation.method,
        simulation.autopsy,
      )
    : null;

  // --- Multiple motives -------------------------------------------------------
  const relevantIds = new Set<PersonId>([...suspects.map((s) => s.id), culprit.id]);
  const suspectMotives = groupMotivesByHolder(rawCandidates, relevantIds);

  const witnessedPersonIds = new Set(knowledge.map((k) => k.personId));
  for (const person of people) {
    if (person.id === victim.id) person.roles.push("victim");
    if (person.id === culprit.id) person.roles.push("culprit");
    if (accompliceResult.accomplices.some((a) => a.personId === person.id)) person.roles.push("accomplice");
    if (person.roles.length === 0) {
      person.roles.push(witnessedPersonIds.has(person.id) ? "witness" : "bystander");
    }
  }

  // --- Post-crime observation layer (Living Investigation System, Phase 5A) --
  // A domain-separated stream (`rootRng.derive("post-crime-observation")` is
  // exactly `createRootRng(seed).derive(...)`, since `rootRng` already IS
  // `createRootRng(seed)`) — `RNG.derive` forks an entirely independent,
  // order-insensitive sub-stream (see rng.ts), so adding this call here
  // changes nothing about any other derive() call's output, for any seed,
  // regardless of where in this function it happens to run. Deliberately
  // excludes only the victim (dead, so cannot have a post-crime routine —
  // a narrative fact the player already knows from the case briefing, not
  // hidden information) and passes every other person through the exact
  // same `PostCrimeSubject` projection, with no `roles`/personality/motive
  // field for the generator to even theoretically branch on.
  const postCrimeSubjects: PostCrimeSubject[] = people
    .filter((p) => p.id !== victim.id)
    .map((p) => ({ id: p.id, firstName: p.firstName, lastName: p.lastName, homeLocationId: p.homeLocationId, workLocationId: p.workLocationId }));
  const postCrimeMovements = generatePostCrimeMovements(rootRng.derive("post-crime-observation"), {
    people: postCrimeSubjects,
    caseOpenedAt: simulation.caseOpenedAt,
  });

  const caseTruth: CaseTruth = {
    seed,
    difficulty,
    crimeType: "homicide",
    archetype: archetype.id,
    generatedAt: new Date().toISOString(),
    locations,
    people,
    relationships,
    victimId: victim.id,
    culpritId: culprit.id,
    accompliceIds: accompliceResult.accomplices.map((a) => a.personId),
    accomplices: accompliceResult.accomplices,
    suspectIds: suspects.map((s) => s.id),
    motive,
    suspectMotives,
    method: simulation.method,
    methodType: simulation.methodType,
    weapon: simulation.weapon,
    crimeLocationId: simulation.crimeLocationId,
    crimeTimestamp: simulation.crimeTimestamp,
    premeditated: simulation.premeditated,
    staging: stagingApplication.info,
    falseConfession,
    tamperingEvents: tamperingApplication.tamperingEvents,
    sharedResources,
    timeline: workingTimeline,
    evidence,
    knowledge,
    testimony,
    alibis,
    autopsy: {
      ...simulation.autopsy,
      notableFeatures: [...simulation.autopsy.notableFeatures, ...stagingApplication.autopsyNotableFeatureAdditions],
    },
    redHerringPersonIds: redHerringPeople.map((p) => p.id),
    postCrimeMovements,
  };

  return caseTruth;
}
