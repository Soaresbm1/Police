import type { RNG } from "../random/rng";
import type { Person, PersonId } from "../types/person";
import { fullName } from "../types/person";
import type { Relationship } from "../types/relationship";
import { RelationshipGraph } from "../types/relationship";
import type { Alibi, AutopsyReport, FalseConfession, FalseConfessionReason } from "../types/case";
import type { Evidence } from "../types/evidence";
import type { GameMinutes } from "../types/time";
import { formatGameTime } from "../types/time";

export function decideFalseConfession(rng: RNG, chance: number): boolean {
  return rng.bool(chance);
}

interface ConfessorPick {
  person: Person;
  reason: FalseConfessionReason;
  protectedPersonId: PersonId | null;
}

/** Picks a plausible false confessor among the suspects (never the real
 * culprit) — one whose personal circumstances make each reason believable,
 * rather than an arbitrary random name. */
function pickConfessor(rng: RNG, culprit: Person, suspects: Person[], relationships: Relationship[]): ConfessorPick | null {
  const graph = new RelationshipGraph(relationships);
  const pool = suspects.filter((s) => s.id !== culprit.id);
  if (pool.length === 0) return null;

  const candidates: ConfessorPick[] = [];

  for (const person of pool) {
    const tieToCulprit = graph.between(person.id, culprit.id);
    if (tieToCulprit && tieToCulprit.attributes.trust + tieToCulprit.attributes.affection + tieToCulprit.attributes.dependency > 1.1) {
      candidates.push({ person, reason: "protecting_someone", protectedPersonId: culprit.id });
    }
    if (person.personality.fearfulness > 0.7 || person.baselineStress > 0.7) {
      candidates.push({ person, reason: "fear", protectedPersonId: null });
    }
    const pressuringTie = graph.of(person.id).find((r) => r.secret !== null && (r.from === person.id || r.to === person.id));
    if (pressuringTie) {
      candidates.push({ person, reason: "coercion_pressure", protectedPersonId: null });
    }
    const ownSecret = graph.of(person.id).find((r) => r.secret !== null);
    if (ownSecret) {
      candidates.push({ person, reason: "guilt_for_another_secret", protectedPersonId: null });
    }
  }

  if (candidates.length === 0) {
    // Fall back to any non-culprit suspect with the vaguest, always-available reason.
    return { person: rng.pick(pool), reason: "fear", protectedPersonId: null };
  }
  return rng.pick(candidates);
}

const REASON_EXPLANATION: Record<FalseConfessionReason, (confessor: Person, protectedPerson: Person | null) => string> = {
  protecting_someone: (c, p) =>
    p ? `${fullName(c)} s'accuse à tort pour protéger ${fullName(p)}.` : `${fullName(c)} s'accuse à tort pour protéger un proche.`,
  fear: (c) => `${fullName(c)} s'accuse à tort, submergé·e par la peur et la pression de l'enquête.`,
  coercion_pressure: (c) => `${fullName(c)} s'accuse à tort, sous la pression de circonstances qui le/la menacent.`,
  guilt_for_another_secret: (c) => `${fullName(c)} s'accuse à tort, rongé·e par la culpabilité d'un tout autre secret.`,
};

const FAKE_MOTIVE_TEXT: Record<FalseConfessionReason, (victimName: string) => string> = {
  protecting_someone: (v) => `Prétend avoir agi seul·e par rancune envers ${v}, sans mentionner personne d'autre.`,
  fear: (v) => `Prétend avoir agi sous le coup de la colère contre ${v}, sans autre explication.`,
  coercion_pressure: (v) => `Prétend avoir agi pour régler une dette personnelle avec ${v}.`,
  guilt_for_another_secret: (v) => `Prétend avoir agi par jalousie envers ${v}.`,
};

/**
 * Builds the false confession record: a full, structured claimed account —
 * reconstruction, method, timing, motive — not merely a testimony flag.
 * `claimedTimingStart/End` is always shifted away from the real autopsy
 * window (see the validator's checkFalseConfession) so a careful player can
 * always catch the lie against evidence visible from the very start of the
 * case, without needing anything else discovered first. `disprovingEvidenceIds`
 * is a *second*, independent way to disprove it — first choice is the
 * confessor's own corroborated alibi (proof they were elsewhere), falling
 * back to evidence that already implicates the real culprit instead.
 */
export function buildFalseConfession(
  rng: RNG,
  culprit: Person,
  victim: Person,
  suspects: Person[],
  relationships: Relationship[],
  alibis: Alibi[],
  evidence: Evidence[],
  crimeMethodText: string,
  autopsy: AutopsyReport,
): FalseConfession | null {
  const pick = pickConfessor(rng, culprit, suspects, relationships);
  if (!pick) return null;

  const ownAlibi = alibis.find((a) => a.personId === pick.person.id);
  let disprovingEvidenceIds = ownAlibi?.corroboratingEvidenceIds ?? [];
  if (disprovingEvidenceIds.length === 0) {
    disprovingEvidenceIds = evidence
      .filter((e) => !e.isRedHerring && e.relatedPersonIds.includes(culprit.id))
      .slice(0, 2)
      .map((e) => e.id);
  }
  if (disprovingEvidenceIds.length === 0) return null;

  const protectedPerson = pick.protectedPersonId ? suspects.find((s) => s.id === pick.protectedPersonId) ?? culprit : null;

  // The confessor knows the death was discovered and roughly when (public,
  // from the discovery report) but was never actually there — so their
  // claimed timing always drifts well clear of the true autopsy window,
  // in a direction (earlier or later) picked at random.
  const driftMinutes = rng.int(90, 240) * (rng.bool(0.5) ? -1 : 1);
  const claimedTimingStart: GameMinutes = autopsy.estimatedDeathWindowStart + driftMinutes;
  const claimedTimingEnd: GameMinutes = autopsy.estimatedDeathWindowEnd + driftMinutes;

  const claimedMethod = crimeMethodText;
  const claimedMotiveText = FAKE_MOTIVE_TEXT[pick.reason](fullName(victim));
  const claimedReconstruction = `${fullName(pick.person)} déclare : « Je me suis rendu·e chez ${fullName(victim)} vers ${formatGameTime(
    claimedTimingStart,
  )}. Nous nous sommes disputés et j'ai fini par le/la tuer, avant de repartir vers ${formatGameTime(claimedTimingEnd)}. »`;
  const conflictingDetail = `${fullName(pick.person)} situe les faits entre ${formatGameTime(claimedTimingStart)} et ${formatGameTime(
    claimedTimingEnd,
  )}, alors que le légiste estime le décès entre ${formatGameTime(autopsy.estimatedDeathWindowStart)} et ${formatGameTime(
    autopsy.estimatedDeathWindowEnd,
  )} — un écart que la confession n'explique pas.`;

  return {
    personId: pick.person.id,
    reason: pick.reason,
    protectedPersonId: pick.protectedPersonId,
    explanation: REASON_EXPLANATION[pick.reason](pick.person, protectedPerson ?? null),
    claimedReconstruction,
    claimedMethod,
    claimedTimingStart,
    claimedTimingEnd,
    claimedMotiveText,
    conflictingDetail,
    disprovingEvidenceIds,
  };
}
