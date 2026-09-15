import { describe, expect, it } from "vitest";
import { generateCase } from "../../case-generator/case-truth";
import type { CaseTruth, Difficulty } from "../../types/case";
import type { PersonId } from "../../types/person";
import { selectReconstructionEventChain, type CrimeEventChainResult } from "../reconstruction-events";
import { deriveActorVisualId } from "../reconstruction-layout";
import { projectReconstruction } from "../reconstruction-projector";
import { findPocCase } from "./poc-case-finder";

const DIFFICULTIES: Difficulty[] = ["recruit", "investigator", "inspector", "expert"];
const CASE_ID = "body-continuity";

function seedFor(i: number): string {
  return `CASE-${(i + 70000).toString(36).toUpperCase().padStart(6, "0").slice(-6)}`;
}

function* generatedCases(perDifficulty: number): Generator<CaseTruth> {
  for (const difficulty of DIFFICULTIES) {
    for (let i = 0; i < perDifficulty; i++) {
      try {
        yield generateCase(seedFor(i), { difficulty });
      } catch {
        // Rare generator dead-ends are covered by the batch tests, not this file.
      }
    }
  }
}

function chainOf(truth: CaseTruth): CrimeEventChainResult {
  const chain = selectReconstructionEventChain(truth);
  if (!chain.ok) throw new Error(chain.reason);
  return chain;
}

function project(truth: CaseTruth) {
  const result = projectReconstruction(truth, CASE_ID);
  if (!result.ok) throw new Error(result.reason);
  return result.scenario;
}

function anchoredEvents(chain: CrimeEventChainResult) {
  return [chain.meet, chain.attack, chain.leaveScene, chain.discover, chain.stageScene].flatMap((sel) => (sel ? [sel.event] : []));
}

function t0Of(chain: CrimeEventChainResult): number {
  return Math.min(...anchoredEvents(chain).map((e) => e.timestamp));
}

/** U5.1's own despawn rule, recomputed independently from truth: end of each person's last anchored participation. */
function lastParticipationEndSecondsByVisualId(truth: CaseTruth, chain: CrimeEventChainResult): Map<string, number> {
  const endByPerson = new Map<PersonId, number>();
  for (const e of anchoredEvents(chain)) {
    const people = new Set<PersonId>([e.actorId, ...(e.counterpartyId ? [e.counterpartyId] : []), ...e.presentPersonIds]);
    for (const p of people) endByPerson.set(p, Math.max(endByPerson.get(p) ?? -Infinity, e.timestamp + e.durationMinutes));
  }
  const t0 = t0Of(chain);
  return new Map([...endByPerson].map(([p, end]) => [deriveActorVisualId(CASE_ID, p), (end - t0) * 60]));
}

describe("CaseTruth invariants the body-presence rule relies on", () => {
  it("across 400 generated cases: one case-opening observe at the crime scene, death before it, no victim record after the attack", () => {
    let checked = 0;
    for (const truth of generatedCases(100)) {
      const attack = chainOf(truth).attack.event;
      const attackEnd = attack.timestamp + attack.durationMinutes;
      const discoveries = truth.timeline.filter(
        (e) => e.action === "observe" && e.locationId === truth.crimeLocationId && e.timestamp === truth.caseOpenedAt,
      );
      expect(discoveries).toHaveLength(1);
      expect(truth.autopsy.estimatedDeathWindowEnd).toBeLessThan(truth.caseOpenedAt);
      const victimLater = (e: CaseTruth["timeline"][number]) =>
        e.timestamp >= attackEnd && (e.actorId === truth.victimId || e.presentPersonIds.includes(truth.victimId));
      expect(truth.timeline.filter(victimLater)).toHaveLength(0);
      expect(truth.postCrimeMovements.filter(victimLater)).toHaveLength(0);
      checked++;
    }
    expect(checked).toBeGreaterThan(380);
  });
});

describe("projectReconstruction — body presence through discovery", () => {
  const poc = findPocCase();
  if (!poc) throw new Error("POC case not found");

  it("keeps the victim present until the discovery ends", () => {
    const chain = chainOf(poc.truth);
    const scenario = project(poc.truth);
    const victim = scenario.actors.find((a) => a.roleForReconstruction === "victim")!;
    const discover = scenario.events.find((e) => e.type === "discover")!;
    const discoveryEvent = chain.discover!.event;
    const expectedEnd = (discoveryEvent.timestamp + discoveryEvent.durationMinutes - t0Of(chain)) * 60;

    expect(victim.despawnTime).toBe(expectedEnd);
    expect(victim.despawnTime).toBeGreaterThan(discover.time);
  });

  it("the persisted victim is a body: no waypoint and no event role after the attack", () => {
    const scenario = project(poc.truth);
    const victim = scenario.actors.find((a) => a.roleForReconstruction === "victim")!;
    const attack = scenario.events.find((e) => e.type === "attack")!;

    expect(victim.waypoints.every((wp) => wp.time <= attack.time)).toBe(true);
    const laterEventsNamingVictim = scenario.events.filter(
      (e) => e.time > attack.time && (e.actorVisualId === victim.visualId || e.counterpartyVisualId === victim.visualId),
    );
    expect(laterEventsNamingVictim).toHaveLength(0);
  });

  it("discovery stays strictly after the attack and the discoverer still spawns only at discovery", () => {
    const scenario = project(poc.truth);
    const attack = scenario.events.find((e) => e.type === "attack")!;
    const discover = scenario.events.find((e) => e.type === "discover")!;
    const discoverer = scenario.actors.find((a) => a.visualId === discover.actorVisualId)!;

    expect(discover.time).toBeGreaterThan(attack.time);
    expect(discoverer.spawnTime).toBe(discover.time);
  });

  it("the culprit does not persist because the victim does", () => {
    const chain = chainOf(poc.truth);
    const scenario = project(poc.truth);
    const culprit = scenario.actors.find((a) => a.roleForReconstruction === "culprit")!;
    const discover = scenario.events.find((e) => e.type === "discover")!;

    expect(culprit.despawnTime).toBe(lastParticipationEndSecondsByVisualId(poc.truth, chain).get(culprit.visualId));
    expect(culprit.despawnTime).toBeLessThan(discover.time);
  });

  it("across 200 generated cases, only the victim's despawn ever extends past its own last participation", () => {
    let bodiesPersisted = 0;
    for (const truth of generatedCases(50)) {
      const chain = chainOf(truth);
      const scenario = project(truth);
      const expected = lastParticipationEndSecondsByVisualId(truth, chain);
      for (const actor of scenario.actors) {
        if (actor.roleForReconstruction === "victim") {
          expect(actor.despawnTime).toBeGreaterThanOrEqual(expected.get(actor.visualId)!);
          if (actor.despawnTime > expected.get(actor.visualId)!) bodiesPersisted++;
        } else {
          expect(actor.despawnTime).toBe(expected.get(actor.visualId));
        }
      }
    }
    expect(bodiesPersisted).toBeGreaterThan(0);
  });

  it("does not persist the body when the autopsy does not place death before the discovery", () => {
    const truth = structuredClone(poc.truth);
    truth.autopsy.estimatedDeathWindowEnd = truth.caseOpenedAt + 1;
    const chain = chainOf(truth);
    const victim = project(truth).actors.find((a) => a.roleForReconstruction === "victim")!;

    expect(victim.despawnTime).toBe(lastParticipationEndSecondsByVisualId(truth, chain).get(victim.visualId));
  });

  it("does not persist the body when truth records the victim anywhere after the attack", () => {
    const truth = structuredClone(poc.truth);
    const attack = chainOf(truth).attack.event;
    truth.timeline.push({
      ...attack,
      id: "victim-recorded-later",
      isCrimeEvent: false,
      action: "travel",
      timestamp: attack.timestamp + attack.durationMinutes + 30,
      actorId: truth.victimId,
      counterpartyId: null,
      presentPersonIds: [truth.victimId],
    });
    const chain = chainOf(truth);
    const victim = project(truth).actors.find((a) => a.roleForReconstruction === "victim")!;

    expect(victim.despawnTime).toBe(lastParticipationEndSecondsByVisualId(truth, chain).get(victim.visualId));
  });

  it("projection with body presence stays byte-deterministic", () => {
    expect(JSON.stringify(project(poc.truth))).toBe(JSON.stringify(project(poc.truth)));
  });
});

describe("projectReconstruction — discovery anchoring regression", () => {
  it("a generated case whose accomplice lookout observes after the attack still projects the true discovery", () => {
    for (const truth of generatedCases(500)) {
      const attack = chainOf(truth).attack.event;
      const lookoutObserve = truth.timeline.find(
        (e) =>
          e.action === "observe" &&
          e.locationId === truth.crimeLocationId &&
          e.timestamp > attack.timestamp &&
          e.timestamp < truth.caseOpenedAt,
      );
      if (!lookoutObserve) continue;

      const chain = chainOf(truth);
      const discover = project(truth).events.find((e) => e.type === "discover")!;
      expect(discover.time).toBe((truth.caseOpenedAt - t0Of(chain)) * 60);
      expect(discover.actorVisualId).not.toBe(deriveActorVisualId(CASE_ID, lookoutObserve.actorId));
      return;
    }
    throw new Error("no generated case in range had a post-attack lookout observe to regress against");
  });
});
