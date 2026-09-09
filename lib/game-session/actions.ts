"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { generateCase } from "@/lib/game-engine/case-generator/case-truth";
import { generateCaseSeed } from "@/lib/game-engine/random/rng";
import type { Difficulty } from "@/lib/game-engine/types/case";
import { isAutoPortraitGenerationEnabled, runAutoPortraitGeneration } from "@/lib/art/generation/auto-portrait-trigger";
import { isAutoCrimeSceneGenerationEnabled, runAutoCrimeSceneGeneration } from "@/lib/art/generation/auto-scene-trigger";
import { markEventSeen } from "./events";
import * as generatedAssetStore from "@/lib/art/generation/asset-store";
import { activeGeneratedAssetProvider } from "@/lib/art/generation/active-provider";
import { getStore } from "./persistence";
import { getCurrentIdentity } from "./identity";
import { withSession } from "./with-session";
import * as discovery from "./discovery";
import { scoreAccusation } from "./scoring";
import { getInterrogationTopics, markAsked } from "./interrogation-view";
import { markWitnessCallbackSeen, scheduleWitnessCallbackIfEligible } from "./witness-callbacks";
import type { BoardNodeKind, PlayerTimelineStatus } from "./types";

const DIFFICULTIES: Difficulty[] = ["recruit", "investigator", "inspector", "expert"];

function refreshInvestigation() {
  revalidatePath("/investigation", "layout");
}

export async function startNewCase(formData: FormData) {
  const { userId, authenticated } = await getCurrentIdentity();
  if (!authenticated) redirect("/login");

  const raw = String(formData.get("difficulty") ?? "investigator");
  const difficulty: Difficulty = DIFFICULTIES.includes(raw as Difficulty) ? (raw as Difficulty) : "investigator";
  const seed = generateCaseSeed();
  const truth = generateCase(seed, { difficulty });
  await getStore().createSession(userId, seed, difficulty, truth.crimeTimestamp);

  // Pilot-gated (see `.env.example`): queues portrait/crime-scene
  // generation for this brand-new case to run after this response is
  // sent, so the redirect below — and the procedural art it lands on —
  // is never delayed by either. Independently gated flags, so any
  // combination (both off, either alone, both on) works; each has its
  // own try/catch so a failure in one never skips or crashes the other.
  // `userId`/`truth` are read above and captured by closure, per
  // `after()`'s own request-data rule.
  if (isAutoPortraitGenerationEnabled() || isAutoCrimeSceneGenerationEnabled()) {
    after(async () => {
      if (isAutoPortraitGenerationEnabled()) {
        try {
          await runAutoPortraitGeneration({ store: generatedAssetStore, provider: activeGeneratedAssetProvider }, userId, truth);
        } catch (err) {
          console.error(
            `[CASELINE] Automatic portrait generation crashed unexpectedly for case ${seed}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      if (isAutoCrimeSceneGenerationEnabled()) {
        try {
          await runAutoCrimeSceneGeneration({ store: generatedAssetStore, provider: activeGeneratedAssetProvider }, userId, truth);
        } catch (err) {
          console.error(
            `[CASELINE] Automatic crime-scene generation crashed unexpectedly for case ${seed}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    });
  }

  redirect("/investigation/affaire");
}

export async function markEventSeenAction(eventId: string) {
  await withSession(({ session }) => {
    markEventSeen(session, eventId);
  });
  refreshInvestigation();
}

export async function clearMessageAction() {
  await withSession(({ session }) => {
    session.lastActionMessage = null;
    session.lastRevealedEvidenceIds = [];
  });
  refreshInvestigation();
}

export async function endCurrentCase() {
  const { userId, authenticated } = await getCurrentIdentity();
  if (authenticated) await getStore().deleteActiveSession(userId);
  redirect("/");
}

export async function examineCrimeSceneAction() {
  await withSession(({ session, truth }) => {
    const result = discovery.examineCrimeScene(truth, session);
    session.lastActionMessage = result.message;
    session.lastRevealedEvidenceIds = result.revealedEvidenceIds;
  });
  refreshInvestigation();
}

/** Inspecting one crime-scene hotspot: `evidenceId` reveals that specific
 * item (if it's part of the legitimate crime-scene set); a null id means a
 * decoy prop with nothing to find, which is only recorded as "inspected". */
export async function inspectCrimeSceneZoneAction(zoneId: string, evidenceId: string | null) {
  await withSession(({ session, truth }) => {
    if (evidenceId) {
      const result = discovery.inspectCrimeSceneHotspot(truth, session, evidenceId);
      session.lastRevealedEvidenceIds = result.revealedEvidenceIds;
    } else {
      session.crimeSceneExamined = true;
      if (!session.crimeSceneInspectedZoneIds.includes(zoneId)) {
        session.crimeSceneInspectedZoneIds.push(zoneId);
      }
    }
  });
  refreshInvestigation();
}

export async function collectEvidenceAction(evidenceId: string) {
  await withSession(({ session }) => {
    discovery.collectEvidence(session, evidenceId);
  });
  refreshInvestigation();
}

export async function sendToLabAction(evidenceId: string) {
  await withSession(({ session, truth }) => {
    const result = discovery.sendToLab(truth, session, evidenceId);
    session.lastActionMessage = result.message;
  });
  refreshInvestigation();
}

export async function advanceTimeAction(minutes: number) {
  await withSession(({ session }) => {
    const result = discovery.advanceTime(session, minutes);
    session.lastActionMessage =
      result.completedEvidenceIds.length > 0
        ? `Le temps passe... ${result.completedEvidenceIds.length} résultat(s) de laboratoire sont arrivés.`
        : "Le temps passe...";
  });
  refreshInvestigation();
}

export async function askQuestionAction(personId: string, factId: string) {
  await withSession(({ session, truth }) => {
    // A witness's callback (if any) is scheduled the moment the player
    // first engages them at all — the interview only decides WHEN it
    // becomes relevant, never WHAT it contains (Phase 3, req. 9).
    const isFirstInterview = (session.interrogated[personId]?.length ?? 0) === 0;
    markAsked(session, personId, factId);
    if (isFirstInterview) {
      scheduleWitnessCallbackIfEligible(truth, session, personId);
    }
    const revealed = discovery.revealFromInterrogation(truth, session, personId);
    const topics = getInterrogationTopics(truth, session, personId);
    const topic = topics.find((t) => t.factId === factId);
    session.lastActionMessage = topic ? `Réponse obtenue à propos de : ${topic.topicLabel}.` : null;
    session.lastRevealedEvidenceIds = revealed;
    discovery.advanceTime(session, 5);
  });
  refreshInvestigation();
}

/**
 * Called once the interrogation page has actually rendered a ready
 * callback's content (see `WitnessCallbackViewTracker` — fired client-side
 * on mount, i.e. strictly after the browser has painted it). Marking seen
 * only here, never earlier, is what keeps "the player must have actually
 * viewed it" true: nothing before this point (scheduling, the Activity
 * notification, the badge count) ever calls this.
 */
export async function viewWitnessCallbackAction(personId: string) {
  await withSession(({ session }) => {
    markWitnessCallbackSeen(session, personId);
  });
  refreshInvestigation();
}

export async function saveNotesAction(formData: FormData) {
  await withSession(({ session }) => {
    session.notes = String(formData.get("notes") ?? "");
  });
  refreshInvestigation();
}

export async function addPlayerTimelineEntryAction(formData: FormData) {
  const description = String(formData.get("description") ?? "").trim();
  if (!description) return;
  const timeRaw = formData.get("time");
  const status = String(formData.get("status") ?? "hypothesis") as PlayerTimelineStatus;
  const personId = formData.get("personId") ? String(formData.get("personId")) : null;

  await withSession(({ session }) => {
    session.playerTimeline.push({
      id: `pt_${Math.random().toString(36).slice(2)}`,
      time: timeRaw ? Number(timeRaw) : null,
      description,
      personId,
      status,
      createdAt: Date.now(),
    });
  });
  refreshInvestigation();
}

export async function updatePlayerTimelineStatusAction(entryId: string, status: PlayerTimelineStatus) {
  await withSession(({ session }) => {
    const entry = session.playerTimeline.find((e) => e.id === entryId);
    if (entry) entry.status = status;
  });
  refreshInvestigation();
}

export async function deletePlayerTimelineEntryAction(entryId: string) {
  await withSession(({ session }) => {
    session.playerTimeline = session.playerTimeline.filter((e) => e.id !== entryId);
  });
  refreshInvestigation();
}

// Board mutations deliberately skip refreshInvestigation(): the evidence
// board is a Client Component that owns its own canvas state for smooth
// dragging, and no other screen displays board data, so there's nothing
// else that needs to be revalidated. `withSession` still persists the
// change through the active store either way.

// `id` is generated by the caller (the board's Client Component) rather than
// here, so the optimistic node it renders immediately and the one persisted
// server-side are the same object — otherwise a later move/delete on "its"
// id would silently miss the server copy.
export async function addBoardNodeAction(
  id: string,
  kind: BoardNodeKind,
  refId: string,
  label: string,
  detail: string,
  x: number,
  y: number,
) {
  await withSession(({ session }) => {
    session.board.nodes.push({ id, kind, refId, label, detail, x, y });
  });
}

export async function addBoardNoteAction(id: string, text: string, x: number, y: number) {
  await withSession(({ session }) => {
    session.board.nodes.push({ id, kind: "note", refId: "", label: "Note", detail: text, x, y });
  });
}

export async function moveBoardNodeAction(nodeId: string, x: number, y: number) {
  await withSession(({ session }) => {
    const node = session.board.nodes.find((n) => n.id === nodeId);
    if (node) {
      node.x = x;
      node.y = y;
    }
  });
}

export async function removeBoardNodeAction(nodeId: string) {
  await withSession(({ session }) => {
    session.board.nodes = session.board.nodes.filter((n) => n.id !== nodeId);
    session.board.edges = session.board.edges.filter((e) => e.source !== nodeId && e.target !== nodeId);
  });
}

export async function addBoardEdgeAction(id: string, source: string, target: string, label: string) {
  await withSession(({ session }) => {
    session.board.edges.push({ id, source, target, label });
  });
}

export async function removeBoardEdgeAction(edgeId: string) {
  await withSession(({ session }) => {
    session.board.edges = session.board.edges.filter((e) => e.id !== edgeId);
  });
}

export async function submitAccusationAction(formData: FormData) {
  const culpritId = String(formData.get("culpritId") ?? "");
  const motiveType = String(formData.get("motiveType") ?? "");
  const method = String(formData.get("method") ?? "");
  if (!culpritId || !motiveType || !method) {
    await withSession(({ session }) => {
      session.lastActionMessage = "Veuillez compléter tous les champs de l'accusation.";
    });
    refreshInvestigation();
    return;
  }

  // Optional: nobody, one, or several — parallel-indexed repeated fields
  // from the accomplice rows in the form. Empty/duplicate rows and anyone
  // also named as the primary culprit are dropped rather than rejected, so
  // a half-filled row never blocks submitting the accusation.
  const accompliceIds = formData.getAll("accompliceId").map(String);
  const accompliceRoles = formData.getAll("accompliceRole").map(String);
  const seenAccomplices = new Set<string>();
  const accomplices = accompliceIds
    .map((personId, i) => ({ personId, role: accompliceRoles[i] ?? "" }))
    .filter((a) => a.personId && a.personId !== culpritId && !seenAccomplices.has(a.personId) && seenAccomplices.add(a.personId));

  await withSession(async ({ session, truth, userId }) => {
    const accusation = { culpritId, motiveType, method, accomplices, submittedAt: session.currentTime };
    session.accusation = accusation;
    const score = scoreAccusation(truth, session, accusation);
    await getStore().completeCase(userId, { seed: session.seed, difficulty: session.difficulty, accusation, score });
  });
  redirect("/investigation/rapport");
}
