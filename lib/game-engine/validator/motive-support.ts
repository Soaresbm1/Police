import type { CaseTruth, MotiveType } from "../types/case";
import { classifyRelationshipForPhone } from "../case-generator/victim-phone";

/**
 * Motive & Digital Evidence Phase 1 — a server/test-only diagnostic (req.
 * 10), NEVER exposed to the browser. Distinct from `computeSolvability`:
 * a case can be fully solvable (the culprit is provably guilty) while its
 * MOTIVE specifically stays unclear — that's exactly the player-feedback
 * problem this whole phase addresses.
 *
 * Deliberately a pragmatic subset of the 8 channel families the project
 * brief sketches — "interrogation"/"document"/"timeline" are folded into
 * `witness`/`financial`/`cctv` below rather than invented as meaningless
 * separate buckets (the brief's own "do not fabricate evidence merely to
 * hit a number" applies just as much to fabricating channel distinctions).
 *
 * Every check here independently RE-DERIVES support from already-public
 * truth (`relationships`, `evidence`, `testimony`/`knowledge`, `victimPhone`)
 * — it never reads a hidden tag, because no such tag exists anywhere in
 * this codebase (see `victim-phone.ts`'s module doc comment).
 */
export type MotiveSupportChannelFamily = "digital_message" | "financial" | "witness" | "relationship" | "cctv";

export interface MotiveSupportResult {
  motive: MotiveType;
  channelCount: number;
  channelFamilies: MotiveSupportChannelFamily[];
}

const FINANCIAL_MOTIVES: MotiveType[] = ["debt", "money", "fraud", "fear_of_denunciation"];

export function computeMotiveSupport(truth: CaseTruth): MotiveSupportResult {
  const { motive, culpritId } = truth;
  const channels = new Set<MotiveSupportChannelFamily>();

  const groundingRel = truth.relationships.find((r) => motive.groundingRelationshipIds.includes(r.id));
  if (groundingRel) {
    // relationship: the grounding relationship itself is openly knowable
    // (not marked `secret`) — a player who maps the social graph (e.g. via
    // `/investigation/relations` or interrogation) can find it without any
    // digital/financial/witness clue at all.
    if (!groundingRel.secret) channels.add("relationship");

    // digital_message: the culprit is a real victim-phone contact AND has
    // at least one actual conversation AND the SAME relationship classifies
    // to a non-neutral content flavor — re-derived here purely from
    // `relationships`, never from a stored per-message tag (none exists).
    const family = classifyRelationshipForPhone(groundingRel);
    if (family !== "neutral_mundane") {
      const contact = truth.victimPhone.contacts.find((c) => c.personId === culpritId);
      const hasConversation = contact && truth.victimPhone.conversations.some((conv) => conv.contactId === contact.id && conv.messages.length > 0);
      if (hasConversation) channels.add("digital_message");
    }
  }

  // financial: real (non-red-herring) financial-family evidence tied to
  // the culprit, for a money-shaped motive.
  if (FINANCIAL_MOTIVES.includes(motive.type)) {
    const hasFinancialEvidence = truth.evidence.some((e) => !e.isRedHerring && e.family === "financial" && e.relatedPersonIds.includes(culpritId));
    if (hasFinancialEvidence) channels.add("financial");
  }

  // witness: a witness/suspect (never the culprit themself) truthfully
  // testifies about a fact grounded in a timeline event the culprit was
  // actually part of.
  const timelineById = new Map(truth.timeline.map((e) => [e.id, e]));
  const knowledgeById = new Map(truth.knowledge.map((k) => [k.id, k]));
  const hasWitnessSupport = truth.testimony.some((t) => {
    if (t.stance !== "truthful" || t.personId === culpritId) return false;
    const fact = knowledgeById.get(t.aboutFactId);
    const event = fact ? timelineById.get(fact.aboutEventId) : undefined;
    if (!event) return false;
    return event.actorId === culpritId || event.counterpartyId === culpritId || event.presentPersonIds.includes(culpritId);
  });
  if (hasWitnessSupport) channels.add("witness");

  // cctv: camera/dashcam evidence (non-red-herring) placing the culprit.
  const hasCctv = truth.evidence.some(
    (e) => !e.isRedHerring && (e.type === "camera_footage" || e.type === "dashcam_footage") && e.relatedPersonIds.includes(culpritId),
  );
  if (hasCctv) channels.add("cctv");

  return { motive: motive.type, channelCount: channels.size, channelFamilies: [...channels] };
}
