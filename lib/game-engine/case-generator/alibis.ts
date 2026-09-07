import type { RNG } from "../random/rng";
import type { Person, PersonId } from "../types/person";
import type { Location } from "../types/location";
import { Timeline } from "../types/timeline";
import type { Evidence } from "../types/evidence";
import type { Alibi } from "../types/case";
import { formatGameTime } from "../types/time";

const ALIBI_WINDOW_HALF_WIDTH = 45;
const EVIDENCE_MATCH_TOLERANCE = 20;

export function computeAlibiSupport(
  alibi: Pick<Alibi, "personId" | "windowStart" | "windowEnd" | "claimedLocationId">,
  evidence: Evidence[],
): { corroborating: string[]; contradicting: string[] } {
  const corroborating: string[] = [];
  const contradicting: string[] = [];

  for (const ev of evidence) {
    if (!ev.relatedPersonIds.includes(alibi.personId)) continue;
    if (ev.timestamp < alibi.windowStart - EVIDENCE_MATCH_TOLERANCE || ev.timestamp > alibi.windowEnd + EVIDENCE_MATCH_TOLERANCE) {
      continue;
    }
    if (ev.relatedLocationIds.includes(alibi.claimedLocationId)) {
      corroborating.push(ev.id);
    } else {
      contradicting.push(ev.id);
    }
  }

  return { corroborating, contradicting };
}

export function buildAlibis(
  rng: RNG,
  suspects: Person[],
  culpritId: PersonId,
  crimeTimestamp: number,
  timeline: Timeline,
  locations: Location[],
  evidence: Evidence[],
): Alibi[] {
  const alibiRng = rng.derive("alibis");
  const windowStart = crimeTimestamp - ALIBI_WINDOW_HALF_WIDTH;
  const windowEnd = crimeTimestamp + ALIBI_WINDOW_HALF_WIDTH;
  const locationsById = new Map(locations.map((l) => [l.id, l]));
  const alibis: Alibi[] = [];

  for (const suspect of suspects) {
    const realEvent = timeline.at(suspect.id, crimeTimestamp);
    const realLocationId = realEvent?.locationId ?? suspect.homeLocationId;
    const isCulprit = suspect.id === culpritId;

    let claimedLocationId = realLocationId;
    let isTrue = true;
    let claimText: string;

    if (isCulprit && realLocationId !== suspect.homeLocationId) {
      claimedLocationId = suspect.homeLocationId;
      isTrue = false;
      claimText = `${suspect.firstName} ${suspect.lastName} affirme être resté·e chez lui/elle entre ${formatGameTime(windowStart)} et ${formatGameTime(windowEnd)}.`;
    } else if (isCulprit) {
      isTrue = true;
      claimText = `${suspect.firstName} ${suspect.lastName} affirme être resté·e seul·e chez lui/elle toute la soirée.`;
    } else if (alibiRng.bool(0.15)) {
      const decoyVenues = locations.filter((l) => (l.type === "bar" || l.type === "hotel") && l.id !== realLocationId);
      const decoy = decoyVenues.length > 0 ? alibiRng.pick(decoyVenues) : undefined;
      if (decoy) {
        claimedLocationId = decoy.id;
        isTrue = false;
        claimText = `${suspect.firstName} ${suspect.lastName} prétend avoir été à ${decoy.name}, pour une raison sans rapport avec l'affaire.`;
      } else {
        claimText = `${suspect.firstName} ${suspect.lastName} affirme avoir été à ${locationsById.get(realLocationId)?.name ?? "un lieu inconnu"}.`;
      }
    } else {
      claimText = `${suspect.firstName} ${suspect.lastName} affirme avoir été à ${locationsById.get(realLocationId)?.name ?? "un lieu inconnu"} entre ${formatGameTime(windowStart)} et ${formatGameTime(windowEnd)}.`;
    }

    const partial: Pick<Alibi, "personId" | "windowStart" | "windowEnd" | "claimedLocationId"> = {
      personId: suspect.id,
      windowStart,
      windowEnd,
      claimedLocationId,
    };
    const { corroborating, contradicting } = computeAlibiSupport(partial, evidence);

    alibis.push({
      personId: suspect.id,
      claim: claimText,
      isTrue,
      windowStart,
      windowEnd,
      claimedLocationId,
      corroboratingEvidenceIds: corroborating,
      contradictingEvidenceIds: contradicting,
    });
  }

  return alibis;
}
