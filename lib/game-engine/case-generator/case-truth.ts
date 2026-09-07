import { createRootRng } from "../random/rng";
import type { CaseSeed, CaseTruth, Difficulty } from "../types/case";
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

export interface GenerateCaseOptions {
  difficulty?: Difficulty;
}

export function generateCase(seed: CaseSeed, options: GenerateCaseOptions = {}): CaseTruth {
  const difficulty = options.difficulty ?? "investigator";
  const config = DIFFICULTY_CONFIGS[difficulty];
  const rootRng = createRootRng(seed);

  const infrastructure = generateTownInfrastructure(rootRng.derive("infrastructure"));
  const population = generatePopulation(rootRng.derive("population"), infrastructure, {
    suspectCount: config.suspectCount,
    witnessCount: config.witnessCount,
  });
  const people = population.people;
  const locations = [...infrastructure, ...population.homeLocations];

  const relationships = generateRelationships(rootRng.derive("relationships"), people, locations);

  const victim = selectVictim(rootRng.derive("victim"), people, relationships);
  const rawCandidates = deriveMotiveCandidates(victim, people, relationships);
  if (rawCandidates.length === 0) {
    throw new Error(`generateCase(${seed}): no viable motive candidates for the selected victim`);
  }
  const candidates = dedupeCandidatesByHolder(rawCandidates);

  const culpritCandidate = pickCulprit(rootRng.derive("culprit"), candidates);
  const culprit = people.find((p) => p.id === culpritCandidate.holderId);
  if (!culprit) throw new Error(`generateCase(${seed}): culprit resolution failed`);
  const motive = toMotive(culpritCandidate);

  const simulation = simulateCaseDay(rootRng.derive("simulation"), people, locations, relationships, victim, culprit, culpritCandidate);
  const timeline = new Timeline(simulation.timeline);

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

  const evidenceFromTimeline = deriveEvidenceFromTimeline(rootRng.derive("evidence"), simulation.timeline, people, locations, {
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

  const evidence = [...evidenceFromTimeline, ...redHerrings];

  const directKnowledge = buildKnowledgeGraph(rootRng.derive("knowledge"), simulation.timeline, people, locations, relationships);
  const secondHandKnowledge = propagateSecondHandKnowledge(
    rootRng.derive("gossip"),
    directKnowledge,
    people,
    relationships,
    simulation.caseOpenedAt,
  );
  const knowledge = [...directKnowledge, ...secondHandKnowledge];

  const alibis = buildAlibis(
    rootRng.derive("alibis"),
    suspects,
    culprit.id,
    simulation.crimeTimestamp,
    timeline,
    locations,
    evidence,
  );

  const testimony = generateTestimony(rootRng.derive("testimony"), knowledge, simulation.timeline, relationships, culprit.id, alibis);

  const witnessedPersonIds = new Set(knowledge.map((k) => k.personId));
  for (const person of people) {
    if (person.id === victim.id) person.roles.push("victim");
    if (person.id === culprit.id) person.roles.push("culprit");
    if (person.roles.length === 0) {
      person.roles.push(witnessedPersonIds.has(person.id) ? "witness" : "bystander");
    }
  }

  const caseTruth: CaseTruth = {
    seed,
    difficulty,
    crimeType: "homicide",
    generatedAt: new Date().toISOString(),
    locations,
    people,
    relationships,
    victimId: victim.id,
    culpritId: culprit.id,
    accompliceIds: [],
    suspectIds: suspects.map((s) => s.id),
    motive,
    method: simulation.method,
    weapon: simulation.weapon,
    crimeLocationId: simulation.crimeLocationId,
    crimeTimestamp: simulation.crimeTimestamp,
    premeditated: simulation.premeditated,
    timeline: simulation.timeline,
    evidence,
    knowledge,
    testimony,
    alibis,
    autopsy: simulation.autopsy,
    redHerringPersonIds: redHerringPeople.map((p) => p.id),
  };

  return caseTruth;
}
