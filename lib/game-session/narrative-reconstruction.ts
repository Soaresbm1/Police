import type { CaseTruth } from "@/lib/game-engine/types/case";
import { fullName, type PersonId } from "@/lib/game-engine/types/person";
import { formatGameTime } from "@/lib/game-engine/types/time";
import { ACCOMPLICE_ROLE_LABEL, ARCHETYPE_LABEL, MOTIVE_LABEL } from "./labels";

export interface NarrativeSection {
  heading: string;
  paragraphs: string[];
  /** People this section is about — lets the reveal show a portrait next
   * to the text instead of a flat paragraph block. Always a subset of ids
   * already referenced by this section's own paragraphs; never new
   * information. */
  personIds?: string[];
  /** The one location this section centers on, if any. */
  locationId?: string;
  /** A formatted in-game time label, when this section anchors to a
   * specific moment (powers the reveal's connected timeline view). */
  timeLabel?: string;
}

function personName(truth: CaseTruth, id: string): string {
  const p = truth.people.find((person) => person.id === id);
  return p ? fullName(p) : "une personne inconnue";
}

function locationName(truth: CaseTruth, id: string): string {
  return truth.locations.find((l) => l.id === id)?.name ?? "un lieu inconnu";
}

/**
 * Deterministically reconstructs the case as a coherent story, purely from
 * already-generated `CaseTruth` fields — no invented facts, no LLM. Every
 * sentence traces back to a concrete field (a Motive, a TimelineEvent, a
 * TestimonyLine, an Evidence description); this only orders and phrases
 * what the engine already decided.
 */
export function buildNarrativeReconstruction(truth: CaseTruth): NarrativeSection[] {
  const sections: NarrativeSection[] = [];
  const victimName = personName(truth, truth.victimId);
  const culpritName = personName(truth, truth.culpritId);
  const crimeLocationName = locationName(truth, truth.crimeLocationId);

  // --- Context --------------------------------------------------------------
  sections.push({
    heading: "Contexte",
    paragraphs: [
      `Cette affaire est un cas de ${ARCHETYPE_LABEL[truth.archetype].toLowerCase()}. ${victimName}, ${
        truth.people.find((p) => p.id === truth.victimId)?.age ?? "?"
      } ans, a été tué·e par ${culpritName}, avec qui ${victimName} entretenait une relation qui a fini par dégénérer.`,
    ],
    personIds: [truth.victimId, truth.culpritId],
  });

  // --- Motive -----------------------------------------------------------------
  sections.push({
    heading: "Mobile",
    paragraphs: [`${MOTIVE_LABEL[truth.motive.type]} — ${truth.motive.description}`],
    personIds: [truth.culpritId],
  });

  // --- Preparation --------------------------------------------------------------
  const prepEvent = truth.timeline.find((e) => e.action === "purchase" && e.actorId === truth.culpritId);
  const plannerAccomplices = truth.accomplices.filter((a) => a.role === "planner");
  const prepParagraphs: string[] = [];
  if (truth.premeditated) {
    prepParagraphs.push(`${culpritName} a prémédité son geste.`);
    if (prepEvent) prepParagraphs.push(prepEvent.description);
    for (const acc of plannerAccomplices) {
      prepParagraphs.push(acc.involvementDescription);
    }
  } else {
    prepParagraphs.push(`Rien n'indique que ${culpritName} ait prémédité son geste — les faits se sont produits de façon impulsive.`);
  }
  sections.push({
    heading: "Préparation",
    paragraphs: prepParagraphs,
    personIds: [truth.culpritId, ...plannerAccomplices.map((a) => a.personId)],
  });

  // --- The crime itself -----------------------------------------------------------
  sections.push({
    heading: "Le crime",
    paragraphs: [
      `${formatGameTime(truth.crimeTimestamp)}, à ${crimeLocationName} : ${truth.method}`,
    ],
    personIds: [truth.culpritId, truth.victimId],
    locationId: truth.crimeLocationId,
    timeLabel: formatGameTime(truth.crimeTimestamp),
  });

  // --- Accomplice actions ------------------------------------------------------------
  if (truth.accomplices.length > 0) {
    sections.push({
      heading: "Rôle des complices",
      paragraphs: truth.accomplices.map(
        (a) => `${personName(truth, a.personId)} (${ACCOMPLICE_ROLE_LABEL[a.role]}) — ${a.involvementDescription}`,
      ),
      personIds: truth.accomplices.map((a) => a.personId),
    });
  }

  // --- Staging / tampering ------------------------------------------------------------
  const coverUpParagraphs: string[] = [];
  if (truth.staging.staged) {
    coverUpParagraphs.push(`${truth.staging.description} : ${culpritName} a tenté de maquiller la scène après les faits.`);
  }
  for (const t of truth.tamperingEvents) {
    coverUpParagraphs.push(t.description);
  }
  if (coverUpParagraphs.length > 0) {
    sections.push({
      heading: "Mise en scène et dissimulation",
      paragraphs: coverUpParagraphs,
      personIds: [truth.culpritId],
      locationId: truth.crimeLocationId,
    });
  }

  // --- Aftermath / discovery ------------------------------------------------------------
  const discoveryEvent = [...truth.timeline].sort((a, b) => a.timestamp - b.timestamp).find((e) => e.action === "observe" && e.timestamp > truth.crimeTimestamp);
  sections.push({
    heading: "Après les faits",
    paragraphs: [discoveryEvent ? discoveryEvent.description : `Le corps de ${victimName} a fini par être découvert.`],
    locationId: discoveryEvent?.locationId ?? truth.crimeLocationId,
    timeLabel: discoveryEvent ? formatGameTime(discoveryEvent.timestamp) : undefined,
  });

  // --- Lies told during the investigation ------------------------------------------------
  // Deliberately scoped to the culprit (and a coordinated false-alibi
  // accomplice, if any) — not every suspect whose testimony happens to
  // include a "lie" stance. A bystander's harmless, unrelated fib (see
  // alibis.ts's decoy-venue roll) is real but irrelevant here: this
  // reconstruction exists to explain the case-defining lies, not to dump
  // every minor inaccuracy in the population's testimony.
  const relevantLiarIds = new Set<string>([truth.culpritId]);
  const falseAlibiAccomplice = truth.accomplices.find((a) => a.role === "false_alibi_provider");
  if (falseAlibiAccomplice) relevantLiarIds.add(falseAlibiAccomplice.personId);

  // The same false alibi claim can back more than one observed moment (a
  // travel ping and a card payment both inside the lied-about window), each
  // producing its own testimony line with identical wording — dedupe by
  // (person, statement) so the reveal doesn't repeat the same quote twice.
  const lies = truth.testimony.filter((t) => t.stance === "lie" && relevantLiarIds.has(t.personId));
  const seenLies = new Set<string>();
  const uniqueLies = lies.filter((l) => {
    const key = `${l.personId}::${l.statement}`;
    if (seenLies.has(key)) return false;
    seenLies.add(key);
    return true;
  });
  if (uniqueLies.length > 0) {
    sections.push({
      heading: "Mensonges tenus durant l'enquête",
      paragraphs: uniqueLies.map((l) => `${personName(truth, l.personId)} : « ${l.statement} »`),
      personIds: [...new Set(uniqueLies.map((l) => l.personId))],
    });
  }

  // --- Evidence that contradicted those lies ----------------------------------------------
  const contradictionParagraphs: string[] = [];
  for (const alibi of truth.alibis) {
    if (alibi.isTrue || alibi.contradictingEvidenceIds.length === 0) continue;
    if (!relevantLiarIds.has(alibi.personId)) continue;
    // Several nearby timeline events (a travel leg and its waypoint sighting,
    // say) can each produce evidence with the same wording — collapse those
    // before quoting them back in the reveal.
    const evDescriptions = [
      ...new Set(
        alibi.contradictingEvidenceIds
          .map((id) => truth.evidence.find((e) => e.id === id)?.description)
          .filter((d): d is string => Boolean(d)),
      ),
    ];
    if (evDescriptions.length === 0) continue;
    contradictionParagraphs.push(`Contre l'alibi de ${personName(truth, alibi.personId)} : ${evDescriptions.join(" ")}`);
  }
  if (truth.falseConfession) {
    contradictionParagraphs.push(truth.falseConfession.conflictingDetail);
  }
  if (contradictionParagraphs.length > 0) {
    sections.push({
      heading: "Comment les preuves ont contredit ces mensonges",
      paragraphs: contradictionParagraphs,
      personIds: [...relevantLiarIds],
    });
  }

  return sections;
}

export interface NarrativeEntityRef {
  id: string;
  name: string;
  avatarSeed: string;
  /** Signed URL of this person's generated portrait, if one is `ready` —
   * resolved by the caller (read-only, never generates) and merged in
   * here so `TruthRevealSequence` doesn't need its own lookup. */
  generatedSrc?: string | null;
}

export interface DisplayNarrativeSection {
  heading: string;
  paragraphs: string[];
  people: NarrativeEntityRef[];
  locationName: string | null;
  timeLabel: string | null;
}

/** Resolves the id references on `NarrativeSection` (people/location) into
 * display-ready names/seeds for the client — called only after the
 * accusation is final, when `CaseTruth` secrecy no longer applies.
 * `portraitUrls` (personId -> signed URL) is optional so existing callers
 * that don't have one keep working unchanged, falling back to procedural
 * portraits everywhere. */
export function enrichNarrativeForDisplay(
  truth: CaseTruth,
  sections: NarrativeSection[],
  portraitUrls: Map<PersonId, string> = new Map(),
): DisplayNarrativeSection[] {
  return sections.map((section) => ({
    heading: section.heading,
    paragraphs: section.paragraphs,
    people: (section.personIds ?? [])
      .map((id) => truth.people.find((p) => p.id === id))
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .map((p) => ({ id: p.id, name: fullName(p), avatarSeed: p.avatarSeed, generatedSrc: portraitUrls.get(p.id) ?? null })),
    locationName: section.locationId ? (locationName(truth, section.locationId) ?? null) : null,
    timeLabel: section.timeLabel ?? null,
  }));
}
