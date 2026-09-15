import "server-only";

import { generateCase } from "@/lib/game-engine/case-generator/case-truth";
import { projectReconstruction } from "@/lib/game-engine/reconstruction/reconstruction-projector";
import type { ReconstructionScenario } from "@/lib/game-engine/reconstruction/reconstruction-types";
import type { CaseTruth } from "@/lib/game-engine/types/case";
import { getCurrentIdentity } from "./identity";
import { getStore } from "./persistence";

/**
 * The only path from a case to a player-visible ReconstructionScenario. Same release rule as the written truth
 * reveal: an active case only once an accusation is on record, an archived case only for its owner. Every check
 * runs server-side before the case is regenerated, and only the projected scenario leaves this module — never the
 * seed, the CaseTruth, or anything else the projector read.
 */

export type ReconstructionUnavailableReason = "unauthenticated" | "no_active_case" | "unresolved" | "not_found" | "projection_failed";

export type ReconstructionRelease =
  | { available: true; scenario: ReconstructionScenario }
  | { available: false; reason: ReconstructionUnavailableReason };

export async function getActiveCaseReconstruction(): Promise<ReconstructionRelease> {
  const identity = await getCurrentIdentity();
  if (!identity.authenticated) return { available: false, reason: "unauthenticated" };

  const session = await getStore().getActiveSession(identity.userId);
  if (!session) return { available: false, reason: "no_active_case" };
  if (!session.accusation) return { available: false, reason: "unresolved" };

  return project(generateCase(session.seed, { difficulty: session.difficulty }), session.id);
}

export async function getArchivedCaseReconstruction(entryId: string): Promise<ReconstructionRelease> {
  const identity = await getCurrentIdentity();
  if (!identity.authenticated) return { available: false, reason: "unauthenticated" };

  const entry = await getStore().getCaseHistoryEntry(identity.userId, entryId);
  if (!entry) return { available: false, reason: "not_found" };

  return project(generateCase(entry.seed, { difficulty: entry.difficulty }), entry.id);
}

function project(truth: CaseTruth, caseId: string): ReconstructionRelease {
  const result = projectReconstruction(truth, caseId);
  return result.ok ? { available: true, scenario: result.scenario } : { available: false, reason: "projection_failed" };
}
