"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { generateCase } from "@/lib/game-engine/case-generator/case-truth";
import { generateCaseSeed } from "@/lib/game-engine/random/rng";
import type { Difficulty } from "@/lib/game-engine/types/case";
import { createSession, deleteSession, getSession } from "./store";
import { SESSION_COOKIE } from "./current";
import * as discovery from "./discovery";
import { getInterrogationTopics, markAsked } from "./interrogation-view";
import type { BoardNodeKind, PlayerTimelineStatus } from "./types";

const DIFFICULTIES: Difficulty[] = ["recruit", "investigator", "inspector", "expert"];

async function requireSession() {
  const jar = await cookies();
  const id = jar.get(SESSION_COOKIE)?.value;
  const session = getSession(id);
  if (!session) throw new Error("Aucune enquête en cours.");
  const truth = generateCase(session.seed, { difficulty: session.difficulty });
  return { session, truth };
}

function refreshInvestigation() {
  revalidatePath("/investigation", "layout");
}

export async function startNewCase(formData: FormData) {
  const raw = String(formData.get("difficulty") ?? "investigator");
  const difficulty: Difficulty = DIFFICULTIES.includes(raw as Difficulty) ? (raw as Difficulty) : "investigator";
  const seed = generateCaseSeed();
  const truth = generateCase(seed, { difficulty });
  const session = createSession(seed, difficulty, truth.crimeTimestamp);

  const jar = await cookies();
  jar.set(SESSION_COOKIE, session.id, { httpOnly: true, sameSite: "lax", path: "/" });
  redirect("/investigation/affaire");
}

export async function clearMessageAction() {
  const { session } = await requireSession();
  session.lastActionMessage = null;
  session.lastRevealedEvidenceIds = [];
  refreshInvestigation();
}

export async function endCurrentCase() {
  const jar = await cookies();
  const id = jar.get(SESSION_COOKIE)?.value;
  if (id) {
    deleteSession(id);
    jar.delete(SESSION_COOKIE);
  }
  redirect("/");
}

export async function examineCrimeSceneAction() {
  const { session, truth } = await requireSession();
  const result = discovery.examineCrimeScene(truth, session);
  session.lastActionMessage = result.message;
  session.lastRevealedEvidenceIds = result.revealedEvidenceIds;
  refreshInvestigation();
}

export async function collectEvidenceAction(evidenceId: string) {
  const { session } = await requireSession();
  discovery.collectEvidence(session, evidenceId);
  refreshInvestigation();
}

export async function sendToLabAction(evidenceId: string) {
  const { session, truth } = await requireSession();
  const result = discovery.sendToLab(truth, session, evidenceId);
  session.lastActionMessage = result.message;
  refreshInvestigation();
}

export async function advanceTimeAction(minutes: number) {
  const { session } = await requireSession();
  const result = discovery.advanceTime(session, minutes);
  session.lastActionMessage =
    result.completedEvidenceIds.length > 0
      ? `Le temps passe... ${result.completedEvidenceIds.length} résultat(s) de laboratoire sont arrivés.`
      : "Le temps passe...";
  refreshInvestigation();
}

export async function askQuestionAction(personId: string, factId: string) {
  const { session, truth } = await requireSession();
  markAsked(session, personId, factId);
  const revealed = discovery.revealFromInterrogation(truth, session, personId);
  const topics = getInterrogationTopics(truth, session, personId);
  const topic = topics.find((t) => t.factId === factId);
  session.lastActionMessage = topic ? `Réponse obtenue à propos de : ${topic.topicLabel}.` : null;
  session.lastRevealedEvidenceIds = revealed;
  discovery.advanceTime(session, 5);
  refreshInvestigation();
}

export async function saveNotesAction(formData: FormData) {
  const { session } = await requireSession();
  session.notes = String(formData.get("notes") ?? "");
  refreshInvestigation();
}

export async function addPlayerTimelineEntryAction(formData: FormData) {
  const { session } = await requireSession();
  const description = String(formData.get("description") ?? "").trim();
  if (!description) return;
  const timeRaw = formData.get("time");
  const status = String(formData.get("status") ?? "hypothesis") as PlayerTimelineStatus;
  const personId = formData.get("personId") ? String(formData.get("personId")) : null;

  session.playerTimeline.push({
    id: `pt_${Math.random().toString(36).slice(2)}`,
    time: timeRaw ? Number(timeRaw) : null,
    description,
    personId,
    status,
    createdAt: Date.now(),
  });
  refreshInvestigation();
}

export async function updatePlayerTimelineStatusAction(entryId: string, status: PlayerTimelineStatus) {
  const { session } = await requireSession();
  const entry = session.playerTimeline.find((e) => e.id === entryId);
  if (entry) entry.status = status;
  refreshInvestigation();
}

export async function deletePlayerTimelineEntryAction(entryId: string) {
  const { session } = await requireSession();
  session.playerTimeline = session.playerTimeline.filter((e) => e.id !== entryId);
  refreshInvestigation();
}

// Board mutations deliberately skip refreshInvestigation(): the evidence
// board is a Client Component that owns its own canvas state for smooth
// dragging, and no other screen displays board data, so there's nothing
// else that needs to be revalidated.

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
  const { session } = await requireSession();
  session.board.nodes.push({ id, kind, refId, label, detail, x, y });
}

export async function addBoardNoteAction(id: string, text: string, x: number, y: number) {
  const { session } = await requireSession();
  session.board.nodes.push({ id, kind: "note", refId: "", label: "Note", detail: text, x, y });
}

export async function moveBoardNodeAction(nodeId: string, x: number, y: number) {
  const { session } = await requireSession();
  const node = session.board.nodes.find((n) => n.id === nodeId);
  if (node) {
    node.x = x;
    node.y = y;
  }
}

export async function removeBoardNodeAction(nodeId: string) {
  const { session } = await requireSession();
  session.board.nodes = session.board.nodes.filter((n) => n.id !== nodeId);
  session.board.edges = session.board.edges.filter((e) => e.source !== nodeId && e.target !== nodeId);
}

export async function addBoardEdgeAction(id: string, source: string, target: string, label: string) {
  const { session } = await requireSession();
  session.board.edges.push({ id, source, target, label });
}

export async function removeBoardEdgeAction(edgeId: string) {
  const { session } = await requireSession();
  session.board.edges = session.board.edges.filter((e) => e.id !== edgeId);
}

export async function submitAccusationAction(formData: FormData) {
  const { session } = await requireSession();
  const culpritId = String(formData.get("culpritId") ?? "");
  const motiveType = String(formData.get("motiveType") ?? "");
  const method = String(formData.get("method") ?? "");
  if (!culpritId || !motiveType || !method) {
    session.lastActionMessage = "Veuillez compléter tous les champs de l'accusation.";
    refreshInvestigation();
    return;
  }
  session.accusation = { culpritId, motiveType, method, submittedAt: session.currentTime };
  redirect("/investigation/rapport");
}
