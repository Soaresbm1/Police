import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CaseTruth } from "@/lib/game-engine/types/case";

/**
 * Release gate for the player-facing reconstruction, exercised at the module the pages call. Identity is mocked
 * (it reads request cookies); the in-memory SessionStore, case generation and the projector run for real, with
 * generation and projection spied so the tests can prove neither runs before the gate passes.
 */
const { identity, generateCaseSpy, projectSpy } = vi.hoisted(() => ({
  identity: { userId: "", authenticated: true },
  generateCaseSpy: vi.fn(),
  projectSpy: vi.fn(),
}));

vi.mock("../identity", () => ({
  getCurrentIdentity: vi.fn(async () => ({ userId: identity.userId, authenticated: identity.authenticated, displayEmail: null })),
}));
vi.mock("@/lib/game-engine/case-generator/case-truth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/game-engine/case-generator/case-truth")>();
  generateCaseSpy.mockImplementation(actual.generateCase);
  return { ...actual, generateCase: generateCaseSpy };
});
vi.mock("@/lib/game-engine/reconstruction/reconstruction-projector", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/game-engine/reconstruction/reconstruction-projector")>();
  projectSpy.mockImplementation(actual.projectReconstruction);
  return { ...actual, projectReconstruction: projectSpy };
});

import { getActiveCaseReconstruction, getArchivedCaseReconstruction } from "../reconstruction-release";
import { getStore } from "../persistence";
import { scoreAccusation } from "../scoring";
import type { Accusation } from "../types";

const SEED = "CASE-B00001";
const DIFFICULTY = "investigator" as const;

const ALLOWED_KEYS = new Set([
  "available",
  "scenario",
  "version",
  "caseId",
  "environment",
  "durationSeconds",
  "actors",
  "events",
  "visualId",
  "roleForReconstruction",
  "genericAppearance",
  "spawnTime",
  "despawnTime",
  "waypoints",
  "time",
  "slot",
  "type",
  "actorVisualId",
  "counterpartyVisualId",
  "locationSlot",
  "safeVisualAction",
]);

let userCounter = 0;

async function realTruth(): Promise<CaseTruth> {
  const { generateCase } = await vi.importActual<typeof import("@/lib/game-engine/case-generator/case-truth")>("@/lib/game-engine/case-generator/case-truth");
  return generateCase(SEED, { difficulty: DIFFICULTY });
}

function accusationFor(truth: CaseTruth): Accusation {
  return { culpritId: truth.culpritId, motiveType: truth.motive.type, method: truth.methodType, accomplices: [], submittedAt: truth.caseOpenedAt + 600 };
}

function signIn(): string {
  userCounter += 1;
  identity.userId = `release-player-${userCounter}`;
  identity.authenticated = true;
  return identity.userId;
}

async function startCase(userId: string, truth: CaseTruth) {
  return getStore().createSession(userId, SEED, DIFFICULTY, truth.crimeTimestamp);
}

async function archiveCase(userId: string, truth: CaseTruth): Promise<string> {
  const session = await startCase(userId, truth);
  const accusation = accusationFor(truth);
  const score = scoreAccusation(truth, { ...session, accusation }, accusation);
  await getStore().completeCase(userId, { seed: SEED, difficulty: DIFFICULTY, accusation, score });
  const [entry] = await getStore().listCaseHistory(userId);
  return entry.id;
}

function collectKeys(value: unknown, keys: Set<string>) {
  if (Array.isArray(value)) value.forEach((item) => collectKeys(item, keys));
  else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      keys.add(key);
      collectKeys(child, keys);
    }
  }
}

function expectNoTruthLeak(payload: unknown, truth: CaseTruth) {
  const json = JSON.stringify(payload);
  expect(json).not.toContain(truth.seed);
  for (const person of truth.people) expect(json).not.toContain(person.id);
  for (const evidence of truth.evidence) expect(json).not.toContain(evidence.id);
  expect(json).not.toContain(truth.motive.description);
  for (const forbidden of ["seed", "culpritId", "victimId", "motive", "relationships", "evidence", "testimony", "knowledge"]) {
    expect(json).not.toContain(`"${forbidden}"`);
  }
  const keys = new Set<string>();
  collectKeys(payload, keys);
  for (const key of keys) expect(ALLOWED_KEYS.has(key), `unexpected key "${key}"`).toBe(true);
}

describe("reconstruction release gate — active case", () => {
  beforeEach(() => {
    generateCaseSpy.mockClear();
    projectSpy.mockClear();
  });

  it("signed-out visitor: unavailable, nothing generated or projected", async () => {
    identity.authenticated = false;
    identity.userId = "";
    expect(await getActiveCaseReconstruction()).toEqual({ available: false, reason: "unauthenticated" });
    expect(generateCaseSpy).not.toHaveBeenCalled();
    expect(projectSpy).not.toHaveBeenCalled();
  });

  it("no active case: unavailable, nothing generated", async () => {
    signIn();
    expect(await getActiveCaseReconstruction()).toEqual({ available: false, reason: "no_active_case" });
    expect(generateCaseSpy).not.toHaveBeenCalled();
  });

  it("unresolved investigation: unavailable, and the case is never regenerated or projected", async () => {
    const userId = signIn();
    await startCase(userId, await realTruth());

    expect(await getActiveCaseReconstruction()).toEqual({ available: false, reason: "unresolved" });
    expect(generateCaseSpy).not.toHaveBeenCalled();
    expect(projectSpy).not.toHaveBeenCalled();
  });

  it("resolved investigation: available, keyed by the session id, with no truth in the payload", async () => {
    const userId = signIn();
    const truth = await realTruth();
    const session = await startCase(userId, truth);
    await getStore().saveSession(userId, { ...session, accusation: accusationFor(truth) });

    const release = await getActiveCaseReconstruction();

    expect(release.available).toBe(true);
    if (!release.available) return;
    expect(release.scenario.caseId).toBe(session.id);
    expect(release.scenario.events.some((e) => e.type === "attack")).toBe(true);
    expect(projectSpy).toHaveBeenCalledTimes(1);
    expectNoTruthLeak(release, truth);
  });
});

describe("reconstruction release gate — archived dossier", () => {
  beforeEach(() => {
    generateCaseSpy.mockClear();
    projectSpy.mockClear();
  });

  it("owner: available, keyed by the history entry id, with no truth in the payload", async () => {
    const userId = signIn();
    const truth = await realTruth();
    const entryId = await archiveCase(userId, truth);
    generateCaseSpy.mockClear();

    const release = await getArchivedCaseReconstruction(entryId);

    expect(release.available).toBe(true);
    if (!release.available) return;
    expect(release.scenario.caseId).toBe(entryId);
    expectNoTruthLeak(release, truth);
  });

  it("another player's dossier: not found, and the case is never regenerated", async () => {
    const ownerId = signIn();
    const entryId = await archiveCase(ownerId, await realTruth());
    signIn();
    generateCaseSpy.mockClear();
    projectSpy.mockClear();

    expect(await getArchivedCaseReconstruction(entryId)).toEqual({ available: false, reason: "not_found" });
    expect(generateCaseSpy).not.toHaveBeenCalled();
    expect(projectSpy).not.toHaveBeenCalled();
  });

  it("unknown dossier id: not found", async () => {
    signIn();
    expect(await getArchivedCaseReconstruction("case-does-not-exist")).toEqual({ available: false, reason: "not_found" });
    expect(generateCaseSpy).not.toHaveBeenCalled();
  });

  it("signed-out visitor: unavailable", async () => {
    identity.authenticated = false;
    identity.userId = "";
    expect(await getArchivedCaseReconstruction("anything")).toEqual({ available: false, reason: "unauthenticated" });
    expect(generateCaseSpy).not.toHaveBeenCalled();
  });
});
