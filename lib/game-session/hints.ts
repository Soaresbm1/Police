import type { CaseTruth } from "@/lib/game-engine/types/case";
import { RelationshipGraph } from "@/lib/game-engine/types/relationship";
import type { GameSession, HintCategory, HintHistoryEntry, HintLevel, HintState } from "./types";
import { evidenceStatusOf, getVisibleEvidence, displayLocationName, getCameraEquippedLocations, getAlibi, getAlibiAssessment } from "./player-view";
import { getCrimeSceneEvidence } from "./discovery";
import { findEvent } from "./events";
import { getVictimPhoneStatus } from "./victim-phone-view";
import { classifyRelationshipForPhone } from "@/lib/game-engine/case-generator/victim-phone";
import { describeCctvRequest } from "./cctv";
import { mandateKey } from "./mandates";
import { getInterrogationTopics } from "./interrogation-view";
import { getConfrontationOptions, getPerformedConfrontations } from "./confrontations";
import { deriveConfrontationOpportunities } from "@/lib/game-engine/witness/confrontations";
import { computeChronologyCoverage } from "./scoring";
import { LAB_ANALYSIS_LABEL, RECORD_TYPE_LABEL } from "./labels";
import { formatGameTime } from "@/lib/game-engine/types/time";

/**
 * Investigation-guidance system (Motive & Digital Evidence Phase 2).
 *
 * Everything in this module is server-only. A `HintOpportunity` — with its
 * numeric `priority` and category — must never reach the browser; the only
 * thing that crosses the server/client boundary is a `HintPayload`
 * (`{hintId, level, text}`, see `getNextHint`/`escalateHint` below), built
 * from ALREADY-rendered French text baked into each opportunity's
 * `levels` tuple at build time, never at request time from an LLM.
 *
 * Every opportunity is derived from public/already-computed session state
 * (`evidenceStatus`, `session.mandates`, `session.interrogated`,
 * `session.surveillance`, the deferred-reveal event schedule) plus
 * read-only truth facts that are already safe to reason about server-side
 * (evidence family/type/relatedPersonIds, relationship type+attributes via
 * the SAME `classifyRelationshipForPhone` classifier the victim-phone
 * generator uses, chronology coverage). None of it reads `culpritId`
 * directly to decide what to hint about — see each builder's own comment.
 *
 * `witness` (see `HintCategory`) is a reserved-but-unused category in V1:
 * this codebase has no distinct "witness statement discovery" workflow
 * separate from interrogation, so a `witness` opportunity would just
 * duplicate `interrogation` under a different label — see project brief
 * §1's own "prefer strengthening the existing system" instruction.
 */

interface HintOpportunity {
  id: string;
  category: HintCategory;
  /** Higher = more useful right now. Never serialized to the client. */
  priority: number;
  /** Index 0 = Level 1 text, 1 = Level 2, 2 = Level 3. */
  levels: [string, string, string];
}

export interface HintPayload {
  hintId: string;
  level: HintLevel;
  text: string;
  /** True only for the terminal "you've covered the major avenues"
   * message (req. 30) — never a real opportunity, never recorded into
   * `hintState` (nothing to escalate, no penalty, no history entry). */
  terminal?: boolean;
}

export interface HintHistoryView {
  level: HintLevel;
  text: string;
  timeLabel: string;
}

const TERMINAL_TEXT =
  "Vous avez exploité l'essentiel des pistes disponibles. Il est peut-être temps de confronter votre hypothèse aux éléments recueillis.";

const VALID_LEVELS: ReadonlySet<number> = new Set([0, 1, 2, 3]);
const VALID_CATEGORIES: ReadonlySet<string> = new Set<HintCategory>([
  "crime_scene",
  "forensic",
  "financial",
  "digital",
  "witness",
  "interrogation",
  "cctv",
  "phone_records",
  "warrant",
  "surveillance",
  "timeline",
  "evidence_cross_reference",
  "contradiction",
  "alibi",
  "accusation",
]);

function normalizeHintProgress(raw: unknown): Record<string, HintLevel> {
  if (!raw || typeof raw !== "object") return {};
  const result: Record<string, HintLevel> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "number" && VALID_LEVELS.has(value)) result[key] = value as HintLevel;
  }
  return result;
}

function normalizeHintHistoryEntry(raw: unknown): HintHistoryEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.hintId !== "string" || r.hintId.length === 0) return null;
  if (typeof r.category !== "string" || !VALID_CATEGORIES.has(r.category)) return null;
  if (typeof r.level !== "number" || (r.level !== 1 && r.level !== 2 && r.level !== 3)) return null;
  if (typeof r.text !== "string") return null;
  if (typeof r.requestedAt !== "number" || !Number.isFinite(r.requestedAt)) return null;
  return { hintId: r.hintId, category: r.category as HintCategory, level: r.level, text: r.text, requestedAt: r.requestedAt };
}

/**
 * Tolerant normalizer for `hint_state` jsonb — the persistence-layer
 * boundary between whatever a Supabase row actually contains (possibly
 * `null`, `{}`, a partial object from an older app version, or corrupted
 * data from any direct DB edit) and the `HintState` shape the rest of the
 * app can trust. Never throws; anything it can't make sense of is simply
 * dropped rather than crashing session load (req. 5 — "malformed JSON
 * safety"). Deliberately not a general schema-validation framework: three
 * small field-by-field checks are enough for this one small shape.
 */
export function normalizeHintState(raw: unknown): HintState {
  const empty: HintState = { progress: {}, history: [], totalHintsUsed: 0 };
  if (!raw || typeof raw !== "object") return empty;
  const r = raw as Record<string, unknown>;

  const progress = normalizeHintProgress(r.progress);
  const history = Array.isArray(r.history)
    ? r.history.map(normalizeHintHistoryEntry).filter((h): h is HintHistoryEntry => h !== null)
    : [];
  const totalHintsUsed =
    typeof r.totalHintsUsed === "number" && Number.isFinite(r.totalHintsUsed) && r.totalHintsUsed >= 0 ? r.totalHintsUsed : history.length;

  return { progress, history, totalHintsUsed };
}

// ---------------------------------------------------------------------
// Opportunity builders — each reads truth+session and returns null when
// the underlying path doesn't genuinely exist or is already resolved.
// ---------------------------------------------------------------------

function buildCrimeSceneOpportunity(truth: CaseTruth, session: GameSession): HintOpportunity | null {
  const undiscovered = getCrimeSceneEvidence(truth).filter((ev) => evidenceStatusOf(session, ev.id) === "undiscovered");
  if (undiscovered.length === 0) return null;
  const location = truth.locations.find((l) => l.id === truth.crimeLocationId);
  const locationName = location ? displayLocationName(location) : "la scène";
  return {
    id: "crime-scene-examine",
    category: "crime_scene",
    priority: 95,
    levels: [
      "Certaines zones de la scène n'ont peut-être pas encore été examinées.",
      "Retournez sur la scène de crime pour y relever les éléments encore inexploités.",
      `Un examen plus approfondi de ${locationName} pourrait révéler d'autres éléments.`,
    ],
  };
}

/** Section 32 — a completed, unread lab report outranks broad exploration.
 * Excludes the victim-phone device (it has its own dedicated opportunity
 * below) so the same underlying event never produces two hints. */
function buildForensicReportReadyOpportunity(truth: CaseTruth, session: GameSession): HintOpportunity | null {
  const unread = getVisibleEvidence(truth, session).filter((ev) => {
    if (ev.playerStatus !== "analyzed" || !ev.requiresLabAnalysis || ev.type === "victim_phone") return false;
    const event = findEvent(session, "lab_result", { kind: "evidence", id: ev.id });
    return event?.status === "ready";
  });
  if (unread.length === 0) return null;
  const sample = [...unread].sort((a, b) => a.id.localeCompare(b.id))[0];
  return {
    id: "forensic-report-ready",
    category: "forensic",
    priority: 120,
    levels: [
      "Un résultat d'analyse est disponible.",
      "Consultez le rapport de laboratoire correspondant depuis l'onglet Preuves ou le Laboratoire.",
      `Le rapport concernant une preuve de type « ${RECORD_TYPE_LABEL[sample.type]} » pourrait clarifier un point resté flou.`,
    ],
  };
}

function buildForensicPendingOpportunity(truth: CaseTruth, session: GameSession): HintOpportunity | null {
  const pending = getVisibleEvidence(truth, session).filter(
    (ev) => ev.requiresLabAnalysis && (ev.playerStatus === "discovered" || ev.playerStatus === "collected"),
  );
  if (pending.length === 0) return null;
  const sample = [...pending].sort((a, b) => a.id.localeCompare(b.id))[0];
  return {
    id: "forensic-pending-analysis",
    category: "forensic",
    priority: 60,
    levels: [
      "Certains éléments physiques n'ont pas encore été envoyés pour analyse.",
      "Examinez les preuves déjà relevées et envoyez celles qui le nécessitent au laboratoire.",
      `Une preuve encore non analysée pourrait bénéficier d'une expertise (${LAB_ANALYSIS_LABEL[sample.requiresLabAnalysis!]}).`,
    ],
  };
}

/** Section 33 — safe because the player already legitimately has access;
 * this only nudges them to actually open what they already unlocked. */
function buildPhoneUnreadOpportunity(truth: CaseTruth, session: GameSession): HintOpportunity | null {
  if (getVictimPhoneStatus(truth, session) !== "ready") return null;
  const device = truth.evidence.find((e) => e.type === "victim_phone");
  if (!device) return null;
  const event = findEvent(session, "lab_result", { kind: "evidence", id: device.id });
  if (event?.status !== "ready") return null; // already seen, or missing
  return {
    id: "digital-phone-unread",
    category: "digital",
    priority: 120,
    levels: [
      "L'extraction du téléphone de la victime est désormais exploitable.",
      "Consultez les messages et appels dans l'application Extraction mobile.",
      "Certains échanges pourraient éclairer les relations de la victime avec son entourage.",
    ],
  };
}

/** Never names who — only whether SOME undiscovered financial evidence
 * exists at all, regardless of which suspect it belongs to. */
function buildFinancialOpportunity(truth: CaseTruth, session: GameSession): HintOpportunity | null {
  const hasUndiscovered = truth.evidence.some((ev) => ev.family === "financial" && evidenceStatusOf(session, ev.id) === "undiscovered");
  if (!hasUndiscovered) return null;
  return {
    id: "financial-unexplored",
    category: "financial",
    priority: 55,
    levels: [
      "Certaines informations financières n'ont pas encore été exploitées.",
      "Comparez l'activité financière récente de l'entourage de la victime avec le reste de l'enquête.",
      "Une réquisition bancaire non encore déposée pourrait donner accès à des informations supplémentaires.",
    ],
  };
}

/** Mirrors `mandates.ts#evaluateMandate`'s own public granting rule
 * (>=1 discovered non-red-herring evidence tying a person to the case) —
 * read-only here, never calling the mutating `evaluateMandate` itself. */
function discoveredEvidenceCountFor(truth: CaseTruth, session: GameSession, personId: string): number {
  return truth.evidence.filter(
    (ev) => !ev.isRedHerring && ev.relatedPersonIds.includes(personId) && evidenceStatusOf(session, ev.id) !== "undiscovered",
  ).length;
}

function buildWarrantOpportunity(truth: CaseTruth, session: GameSession): HintOpportunity | null {
  const candidates = truth.suspectIds
    .map((personId) => ({ personId, count: discoveredEvidenceCountFor(truth, session, personId) }))
    .filter(({ personId, count }) => count > 0 && (!session.mandates[mandateKey("bank", personId)] || !session.mandates[mandateKey("search", personId)]))
    .sort((a, b) => b.count - a.count || a.personId.localeCompare(b.personId));
  if (candidates.length === 0) return null;
  const person = truth.people.find((p) => p.id === candidates[0].personId)!;
  return {
    id: "warrant-unrequested",
    category: "warrant",
    priority: 65,
    levels: [
      "Certaines démarches judiciaires n'ont peut-être pas encore été engagées.",
      "Une personne déjà reliée à l'affaire par une preuve pourrait justifier une réquisition supplémentaire.",
      `Une réquisition concernant ${person.firstName} ${person.lastName} pourrait être envisagée.`,
    ],
  };
}

/** "Meaningful" location = tied to a discovered clue, or a home/workplace,
 * or the crime scene itself — never a random unrelated address, but
 * deliberately as broad as the existing map screen's own definition of
 * what's worth showing (see `player-view.ts#getMapLocations`). */
function buildCctvOpportunity(truth: CaseTruth, session: GameSession): HintOpportunity | null {
  const meaningfulIds = new Set<string>([truth.crimeLocationId]);
  for (const p of truth.people) {
    meaningfulIds.add(p.homeLocationId);
    if (p.workLocationId) meaningfulIds.add(p.workLocationId);
  }
  for (const ev of getVisibleEvidence(truth, session)) for (const locId of ev.relatedLocationIds) meaningfulIds.add(locId);

  const candidates = getCameraEquippedLocations(truth)
    .filter((l) => meaningfulIds.has(l.id) && describeCctvRequest(session, l.id).status === "not_requested")
    .sort((a, b) => a.id.localeCompare(b.id));
  if (candidates.length === 0) return null;
  return {
    id: "cctv-unrequested",
    category: "cctv",
    priority: 50,
    levels: [
      "Certains lieux équipés de caméras n'ont pas encore été vérifiés.",
      "Consultez la vidéosurveillance des lieux déjà associés à l'enquête.",
      `Les enregistrements de ${candidates[0].name} n'ont pas encore été réquisitionnés.`,
    ],
  };
}

function buildInterrogationOpportunity(truth: CaseTruth, session: GameSession): HintOpportunity | null {
  const candidates = truth.people
    .filter((p) => p.id !== truth.victimId)
    .map((p) => ({ person: p, unasked: getInterrogationTopics(truth, session, p.id).filter((t) => !t.asked).length }))
    .filter((c) => c.unasked > 0)
    .sort((a, b) => b.unasked - a.unasked || a.person.id.localeCompare(b.person.id));
  if (candidates.length === 0) return null;
  const top = candidates[0].person;
  return {
    id: "interrogation-unresolved",
    category: "interrogation",
    priority: 58,
    levels: [
      "Certaines personnes interrogées n'ont peut-être pas tout dit — ou n'ont pas encore été interrogées.",
      "Reprenez un interrogatoire et posez les questions encore en suspens.",
      `Une conversation avec ${top.firstName} ${top.lastName} n'a peut-être pas été menée à son terme.`,
    ],
  };
}

/** Low priority by design (req. 23: "optional surveillance" is filler) —
 * considered "resolved" the moment the player has tried it at all once,
 * V1 doesn't track per-person surveillance coverage granularity. */
function buildSurveillanceOpportunity(truth: CaseTruth, session: GameSession): HintOpportunity | null {
  if (Object.keys(session.surveillance).length > 0) return null;
  if (truth.people.length <= 1) return null;
  return {
    id: "surveillance-unused",
    category: "surveillance",
    priority: 20,
    levels: [
      "Une surveillance ciblée pourrait apporter des informations complémentaires.",
      "Envisagez de placer une personne d'intérêt sous surveillance pour une période donnée.",
      "Une surveillance portant sur les heures suivant les faits pourrait révéler des déplacements utiles.",
    ],
  };
}

function buildTimelineOpportunity(truth: CaseTruth, session: GameSession): HintOpportunity | null {
  if (computeChronologyCoverage(truth, session) >= 100) return null;
  return {
    id: "timeline-gap",
    category: "timeline",
    priority: 45,
    levels: [
      "Certains mouvements autour de l'heure des faits n'ont peut-être pas encore été recoupés.",
      "Comparez la chronologie connue avec les autres éléments déjà réunis, en particulier la vidéosurveillance disponible.",
      "Un déplacement proche de l'heure des faits reste à confirmer ou à infirmer avec les preuves déjà réunies.",
    ],
  };
}

/** Section 8/9's PHONE + BANK cross-reference — only offered once the
 * phone has genuinely been read (never before, so it can't double as a
 * "go read the phone" nudge) and only when a real, structurally-detected
 * link exists: a contact whose relationship independently classifies as
 * `financial_dispute` (the SAME classifier `victim-phone.ts` used to
 * generate content — never a stored per-message tag) still has
 * undiscovered financial evidence. */
function buildPhoneFinancialCrossRefOpportunity(truth: CaseTruth, session: GameSession): HintOpportunity | null {
  if (getVictimPhoneStatus(truth, session) !== "ready") return null;
  const device = truth.evidence.find((e) => e.type === "victim_phone");
  if (!device) return null;
  const event = findEvent(session, "lab_result", { kind: "evidence", id: device.id });
  if (event?.status !== "seen") return null; // only once the player actually opened it

  const graph = new RelationshipGraph(truth.relationships);
  const hasLink = truth.victimPhone.contacts.some((c) => {
    if (!c.personId) return false;
    const rel = graph.between(truth.victimId, c.personId);
    if (!rel || classifyRelationshipForPhone(rel) !== "financial_dispute") return false;
    const hasConversation = truth.victimPhone.conversations.some((conv) => conv.contactId === c.id && conv.messages.length > 0);
    if (!hasConversation) return false;
    return truth.evidence.some(
      (ev) => ev.family === "financial" && ev.relatedPersonIds.includes(c.personId!) && evidenceStatusOf(session, ev.id) === "undiscovered",
    );
  });
  if (!hasLink) return null;

  return {
    id: "cross-phone-financial",
    category: "evidence_cross_reference",
    priority: 70,
    levels: [
      "Certaines informations numériques et financières pourraient être liées.",
      "Comparez les échanges récents avec l'activité financière de la même période.",
      "Un échange évoquant l'argent pourrait être à comparer avec une opération financière proche des faits.",
    ],
  };
}

// ---------------------------------------------------------------------
// Contradictions — "where do two things the player already holds not fit?"
//
// Truth-safety: every opportunity below is gated on what the player can ALREADY
// see. `getConfrontationOptions` is the exact list the interrogation page renders
// as "Confronter"/"Relancer" buttons, and `getAlibiAssessment` is the exact
// support/contradiction split the person page renders from DISCOVERED evidence.
// A hint therefore only points at something already on screen; it never reveals
// that a contradiction exists before the evidence behind it has been found.
// The one truth-side read is existence-only and purely a "would this ever resolve"
// guard (see `buildContradictionQuestionOpportunity`), so a hint can never be
// offered for a path the player could not complete.
// ---------------------------------------------------------------------

function personName(truth: CaseTruth, personId: string): string {
  const person = truth.people.find((p) => p.id === personId);
  return person ? `${person.firstName} ${person.lastName}` : "cette personne";
}

/** A statement the player has already taken now clashes with a physical or
 * digital record they have in hand: the confrontation is on offer. Highest
 * priority among the player-initiated avenues, because it is a ready action. */
function buildContradictionConfrontOpportunity(truth: CaseTruth, session: GameSession): HintOpportunity | null {
  const candidates = truth.people
    .filter((p) => p.id !== truth.victimId)
    .map((p) => ({ person: p, options: getConfrontationOptions(truth, session, p.id).filter((o) => o.relationKind === "alibi_conflict") }))
    .filter((c) => c.options.length > 0)
    .sort((a, b) => b.options.length - a.options.length || a.person.id.localeCompare(b.person.id));
  if (candidates.length === 0) return null;
  const top = candidates[0];
  return {
    id: "contradiction-confront",
    category: "contradiction",
    priority: 110,
    levels: [
      "Une déclaration déjà recueillie ne semble pas s'accorder avec un élément de votre dossier.",
      "Retournez aux interrogatoires : une confrontation est désormais possible avec une personne déjà entendue.",
      `Confrontez ${personName(truth, top.person.id)} à « ${top.options[0].evidenceLabel} » lors d'un nouvel entretien.`,
    ],
  };
}

/** The evidence that contradicts someone's alibi is already in the file (and shown
 * as such on their page), but the player has not yet asked them about that
 * statement, so no confrontation is possible yet. Eligible only while there is
 * still an unasked statement to put to them — otherwise it could never resolve. */
function buildContradictionQuestionOpportunity(truth: CaseTruth, session: GameSession): HintOpportunity | null {
  const opportunities = deriveConfrontationOpportunities(truth).filter((op) => op.relationKind === "alibi_conflict");
  const candidates = truth.people
    .filter((p) => p.id !== truth.victimId)
    .filter((p) => {
      const assessment = getAlibiAssessment(truth, session, p.id);
      if (!assessment || assessment.contradicting.length === 0) return false;
      if (getConfrontationOptions(truth, session, p.id).some((o) => o.relationKind === "alibi_conflict")) return false; // the confront hint covers it
      if (getPerformedConfrontations(truth, session, p.id).some((c) => c.relationKind === "alibi_conflict")) return false;
      const asked = new Set(session.interrogated[p.id] ?? []);
      return opportunities.some((op) => op.personId === p.id && !asked.has(op.factId));
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  if (candidates.length === 0) return null;
  return {
    id: "contradiction-question",
    category: "contradiction",
    priority: 85,
    levels: [
      "Une pièce de votre dossier remet en cause la version donnée par l'une des personnes entendues.",
      "Interrogez cette personne sur son emploi du temps : vous pourrez ensuite la confronter à la pièce en question.",
      `Posez à ${personName(truth, candidates[0].id)} les questions sur ses déplacements au moment des faits.`,
    ],
  };
}

/** A confirmed lead for pressing someone who was evasive about an event the
 * police now have documents on. Lower than a real contradiction: it proves the
 * topic is documented, never that the person said anything false. */
function buildFollowupOpportunity(truth: CaseTruth, session: GameSession): HintOpportunity | null {
  const candidates = truth.people
    .filter((p) => p.id !== truth.victimId)
    .map((p) => ({ person: p, options: getConfrontationOptions(truth, session, p.id).filter((o) => o.relationKind === "evidence_backed_followup") }))
    .filter((c) => c.options.length > 0)
    .sort((a, b) => b.options.length - a.options.length || a.person.id.localeCompare(b.person.id));
  if (candidates.length === 0) return null;
  const top = candidates[0];
  return {
    id: "followup-pressure",
    category: "contradiction",
    priority: 62,
    levels: [
      "Certaines personnes entendues n'ont peut-être pas tout dit sur des faits que vous pouvez désormais documenter.",
      "Relancez une personne déjà entendue en lui présentant une pièce relative au même moment.",
      `Relancez ${personName(truth, top.person.id)} avec « ${top.options[0].evidenceLabel} » : elle pourrait préciser sa version.`,
    ],
  };
}

/** A suspect whose alibi could be checked against the file but has not been:
 * nothing found so far supports or contradicts it. Only suspects whose alibi has
 * SOME checkable evidence in the case are considered, so the hint can always be
 * resolved by playing on; it says nothing about which way the check would go. */
function buildAlibiUnverifiedOpportunity(truth: CaseTruth, session: GameSession): HintOpportunity | null {
  const candidates = truth.suspectIds
    .filter((personId) => {
      const alibi = getAlibi(truth, personId);
      if (!alibi || alibi.corroboratingEvidenceIds.length + alibi.contradictingEvidenceIds.length === 0) return false;
      const assessment = getAlibiAssessment(truth, session, personId);
      return !!assessment && assessment.corroborating.length === 0 && assessment.contradicting.length === 0;
    })
    .sort((a, b) => a.localeCompare(b));
  if (candidates.length === 0) return null;
  return {
    id: "alibi-unverified",
    category: "alibi",
    priority: 52,
    levels: [
      "L'alibi de certaines personnes n'a pas encore été recoupé avec les éléments matériels.",
      "Cherchez des pièces (vidéo, téléphonie, relevés) qui confirment ou démentent ce que ces personnes affirment.",
      `L'alibi de ${personName(truth, candidates[0])} n'est, pour l'instant, ni confirmé ni démenti par votre dossier.`,
    ],
  };
}

const BUILDERS: ((truth: CaseTruth, session: GameSession) => HintOpportunity | null)[] = [
  buildContradictionConfrontOpportunity,
  buildContradictionQuestionOpportunity,
  buildFollowupOpportunity,
  buildAlibiUnverifiedOpportunity,
  buildCrimeSceneOpportunity,
  buildForensicReportReadyOpportunity,
  buildPhoneUnreadOpportunity,
  buildForensicPendingOpportunity,
  buildWarrantOpportunity,
  buildInterrogationOpportunity,
  buildPhoneFinancialCrossRefOpportunity,
  buildFinancialOpportunity,
  buildCctvOpportunity,
  buildTimelineOpportunity,
  buildSurveillanceOpportunity,
];

// ---------------------------------------------------------------------
// "Is it time to accuse?" — a read of how much of the essential groundwork is
// done, never of what the answer is.
//
// It is built ONLY from which other hint opportunities are still open (their ids),
// so it can never read `culpritId`, the motive, the weapon or which evidence is
// incriminating: two cases in the same state of progress get the same advice
// whoever did it. "Essential" avenues are the ones any sound accusation rests on
// (the scene, the lab, the phone, the interviews, contradictions and alibis, the
// timeline). Warrants, bank records, cameras and surveillance are optional leads
// that can sharpen a case but are not required to build one.
// ---------------------------------------------------------------------

/** Short player-facing name of each essential avenue, keyed by opportunity id. */
const ESSENTIAL_AVENUES: Readonly<Record<string, string>> = {
  "contradiction-confront": "une confrontation à mener",
  "contradiction-question": "une personne à interroger sur son emploi du temps",
  "crime-scene-examine": "la scène de crime",
  "forensic-report-ready": "un rapport de laboratoire à lire",
  "forensic-pending-analysis": "des preuves à envoyer au laboratoire",
  "digital-phone-unread": "le téléphone de la victime",
  "interrogation-unresolved": "des interrogatoires inachevés",
  "alibi-unverified": "des alibis à vérifier",
  "timeline-gap": "la chronologie des faits",
};

export type AccusationReadiness = "early" | "near" | "ready";

/** Where the player stands: three or more essential avenues open is "early", one
 * or two is "near", none (with only optional leads left) is "ready". Returns null
 * when nothing at all is left to suggest, so the existing terminal message
 * ("you've covered the major avenues") keeps owning that state. Pure and exported
 * for tests. */
export function describeAccusationReadiness(
  openEssential: string[],
  otherOpenCount: number,
): { readiness: AccusationReadiness; levels: [string, string, string] } | null {
  if (openEssential.length === 0 && otherOpenCount === 0) return null;
  const labels = openEssential.map((id) => ESSENTIAL_AVENUES[id]).filter((l): l is string => !!l);
  const list = labels.slice(0, 4).join(" ; ");

  if (openEssential.length >= 3) {
    return {
      readiness: "early",
      levels: [
        "Il est probablement encore tôt pour accuser : plusieurs pistes essentielles restent ouvertes.",
        `Pistes essentielles encore ouvertes : ${list}.`,
        `Commencez par : ${labels[0]}. Accuser maintenant reviendrait à deviner.`,
      ],
    };
  }
  if (openEssential.length >= 1) {
    return {
      readiness: "near",
      levels: [
        "Vous approchez du but : il ne reste que quelques pistes essentielles à clarifier avant d'accuser.",
        `Il reste à traiter : ${list}.`,
        "Une fois ces pistes closes, relisez le tableau et vérifiez que votre hypothèse explique chaque alibi et chaque preuve matérielle.",
      ],
    };
  }
  return {
    readiness: "ready",
    levels: [
      "Les pistes essentielles ont été exploitées : vous pouvez envisager d'accuser si votre hypothèse tient.",
      "Avant d'accuser, vérifiez trois points : qui avait une raison d'agir, qui avait les moyens de le faire, et dont l'alibi ne tient pas.",
      "Les pistes encore ouvertes sont facultatives, mais peuvent encore départager deux hypothèses : une accusation se prépare, elle ne se tente pas.",
    ],
  };
}

function buildAccusationTimingOpportunity(base: HintOpportunity[]): HintOpportunity | null {
  const open = base.filter((o) => o.id in ESSENTIAL_AVENUES).sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  const description = describeAccusationReadiness(
    open.map((o) => o.id),
    base.length - open.length,
  );
  if (!description) return null;
  return { id: "accusation-timing", category: "accusation", priority: 15, levels: description.levels };
}

/** All currently-eligible opportunities, priority descending (id
 * ascending as a stable tiebreak) — recomputed fresh every call, never
 * cached, so a resolved path silently drops out the next time this runs
 * (req. 18 — stale hints are never re-offered). Exported for tests and
 * diagnostics only; never sent to the client as-is (see `HintOpportunity`'s
 * doc comment). */
export function computeHintOpportunities(truth: CaseTruth, session: GameSession): HintOpportunity[] {
  const base = BUILDERS.map((build) => build(truth, session)).filter((o): o is HintOpportunity => o !== null);
  const timing = buildAccusationTimingOpportunity(base);
  return (timing ? [...base, timing] : base).sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
}

function recordHint(session: GameSession, opp: HintOpportunity, level: 1 | 2 | 3): HintPayload {
  const prevLevel = session.hintState.progress[opp.id] ?? 0;
  session.hintState.progress[opp.id] = Math.max(prevLevel, level) as HintLevel;
  if (level > prevLevel) session.hintState.totalHintsUsed += 1;
  const text = opp.levels[level - 1];
  session.hintState.history.push({ hintId: opp.id, category: opp.category, level, text, requestedAt: session.currentTime });
  return { hintId: opp.id, level, text };
}

/**
 * "UNE AUTRE PISTE" — the player asks for a next hint. Prefers the
 * least-escalated opportunity (a never-shown one first), so distinct
 * avenues get surfaced before any single one is dug into deeper — only
 * escalates a previously-shown opportunity when nothing less-explored
 * remains (req. 10's "few meaningful alternatives remain" clause). Returns
 * the terminal guidance message (never recorded — see `HintPayload.terminal`)
 * once `computeHintOpportunities` has nothing left to offer.
 */
export function getNextHint(truth: CaseTruth, session: GameSession): HintPayload {
  const opportunities = computeHintOpportunities(truth, session);
  if (opportunities.length === 0) return { hintId: "terminal", level: 1, text: TERMINAL_TEXT, terminal: true };

  const ranked = opportunities
    .map((o) => ({ o, level: session.hintState.progress[o.id] ?? 0 }))
    .sort((a, b) => a.level - b.level || b.o.priority - a.o.priority || a.o.id.localeCompare(b.o.id));
  const chosen = ranked[0];
  const level = (chosen.level === 0 ? 1 : Math.min(3, chosen.level + 1)) as 1 | 2 | 3;
  return recordHint(session, chosen.o, level);
}

/**
 * "INDICE PLUS PRÉCIS" — escalates one specific, already-shown
 * opportunity by exactly one level (capped at 3). If that opportunity is
 * no longer eligible (the player already resolved it, or session state
 * moved on) it has gone stale — rather than escalate a dead path, this
 * gracefully falls back to `getNextHint` (req. 18).
 */
export function escalateHint(truth: CaseTruth, session: GameSession, hintId: string): HintPayload {
  const opportunities = computeHintOpportunities(truth, session);
  const opp = opportunities.find((o) => o.id === hintId);
  if (!opp) return getNextHint(truth, session);
  const current = session.hintState.progress[hintId] ?? 0;
  const nextLevel = Math.min(3, current + 1) as 1 | 2 | 3;
  return recordHint(session, opp, nextLevel);
}

/** Player-facing hint history (req. 17) — deliberately drops `hintId`/
 * category, exposing only what the player already saw rendered. */
export function getHintHistoryView(session: GameSession): HintHistoryView[] {
  return (session.hintState?.history ?? []).map((h) => ({ level: h.level, text: h.text, timeLabel: formatGameTime(h.requestedAt) }));
}
