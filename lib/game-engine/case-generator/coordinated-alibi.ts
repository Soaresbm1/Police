import type { Person } from "../types/person";
import { fullName } from "../types/person";
import type { Alibi } from "../types/case";
import type { KnowledgeFact, TestimonyLine } from "../types/knowledge";
import type { Evidence } from "../types/evidence";
import type { GameMinutes } from "../types/time";
import { formatGameTime } from "../types/time";
import { computeAlibiSupport } from "./alibis";
import type { FalseAlibiMeeting } from "./accomplices";

const LIE_BUFFER_MINUTES = 25;

/**
 * Turns a real, innocent meeting into a deliberate, coordinated lie: both
 * the culprit's alibi *and* the accomplice's testimony about that same
 * meeting are rewritten to claim they were together well past when the
 * meeting actually ended — far enough to cover the crime. Nothing about the
 * meeting itself is invented; only the claimed *end time* is false, which
 * is exactly what makes it a lie a player can expose with real evidence
 * (the crime scene's own physical evidence already contradicts being
 * anywhere else at that time) rather than a flag with no mechanism behind it.
 */
export function applyCoordinatedFalseAlibi(
  meeting: FalseAlibiMeeting,
  culprit: Person,
  accomplice: Person,
  crimeTimestamp: GameMinutes,
  alibis: Alibi[],
  testimony: TestimonyLine[],
  knowledge: KnowledgeFact[],
  evidence: Evidence[],
): { alibis: Alibi[]; testimony: TestimonyLine[] } {
  const lieWindowStart = meeting.realWindowStart;
  const lieWindowEnd = crimeTimestamp + LIE_BUFFER_MINUTES;

  const culpritClaim = `${fullName(culprit)} affirme être resté·e avec ${fullName(accomplice)} de ${formatGameTime(lieWindowStart)} à ${formatGameTime(lieWindowEnd)}.`;
  const accompliceClaim = `${fullName(accomplice)} confirme : « Nous étions ensemble, de ${formatGameTime(lieWindowStart)} à ${formatGameTime(lieWindowEnd)}. »`;

  function patchAlibi(alibi: Alibi, claim: string): Alibi {
    const patched: Alibi = {
      ...alibi,
      claim,
      isTrue: false,
      claimedLocationId: meeting.locationId,
      windowStart: lieWindowStart,
      windowEnd: lieWindowEnd,
    };
    const { corroborating, contradicting } = computeAlibiSupport(patched, evidence);
    return { ...patched, corroboratingEvidenceIds: corroborating, contradictingEvidenceIds: contradicting };
  }

  const newAlibis = alibis.map((a) => {
    if (a.personId === culprit.id) return patchAlibi(a, culpritClaim);
    if (a.personId === meeting.accompliceId) return patchAlibi(a, accompliceClaim);
    return a;
  });

  function coordinatedLieFor(personId: string, claim: string): TestimonyLine | null {
    const fact = knowledge.find((f) => f.personId === personId && f.aboutEventId === meeting.meetingEventId);
    if (!fact) return null;
    return {
      id: `${fact.id}-coordinated-lie`,
      personId,
      aboutFactId: fact.id,
      stance: "lie",
      statement: claim,
      motiveForStance: `alibi concerté avec ${personId === culprit.id ? fullName(accomplice) : fullName(culprit)}`,
      loyaltyReason: null,
    };
  }

  const culpritLie = coordinatedLieFor(culprit.id, culpritClaim);
  const accompliceLie = coordinatedLieFor(meeting.accompliceId, accompliceClaim);

  const newTestimony = testimony.map((t) => {
    if (culpritLie && t.aboutFactId === culpritLie.aboutFactId && t.personId === culprit.id) return culpritLie;
    if (accompliceLie && t.aboutFactId === accompliceLie.aboutFactId && t.personId === meeting.accompliceId) return accompliceLie;
    return t;
  });

  return { alibis: newAlibis, testimony: newTestimony };
}
