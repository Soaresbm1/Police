import { hashSeed } from "@/lib/art/hash";
import type { PersonId } from "@/lib/game-engine/types/person";

/**
 * Player-test feedback: the culprit kept appearing first in the suspect
 * list and the accusation dropdown, because `CaseTruth.suspects` is built
 * `[culprit, ...otherCandidates]` (see `case-generator/case-truth.ts`) and
 * every consumer rendered that array in its generation order. Reordering
 * generation itself would still leak something (a *different* fixed slot
 * would just become "suspiciously always guilty" instead) — the actual
 * fix has to be presentation-only and provably independent of guilt.
 *
 * `guiltBlindOrderKey` never reads culpritId/guilt/evidence-strength/
 * hidden-role/motive-strength, and never touches `Math.random` — only
 * `caseSeed`+`domain`+`personId`, so the same case always renders the
 * same order (refresh-stable) while different cases scatter differently
 * (no systematic first-position bias). `domain` mirrors the project's
 * `RNG.derive(label)` domain-separation philosophy: the suspect list and
 * the accusation dropdown each get their own independent shuffle, so one
 * screen's order can never be inferred from the other's.
 */
export function guiltBlindOrderKey(caseSeed: string, domain: string, personId: PersonId): number {
  return hashSeed(`${caseSeed}:${domain}:${personId}`);
}

/** Sorts `people` by `guiltBlindOrderKey`; ties (effectively impossible
 * with a 32-bit hash, but not provably so) break on `id` so the result is
 * still fully deterministic. Never mutates the input array. */
export function orderPeopleGuiltBlind<T extends { id: PersonId }>(caseSeed: string, domain: string, people: T[]): T[] {
  return [...people].sort((a, b) => {
    const ka = guiltBlindOrderKey(caseSeed, domain, a.id);
    const kb = guiltBlindOrderKey(caseSeed, domain, b.id);
    return ka - kb || a.id.localeCompare(b.id);
  });
}

export const SUSPECT_LIST_ORDER_DOMAIN = "suspect-list-order";
export const WITNESS_LIST_ORDER_DOMAIN = "witness-list-order";
export const ACCUSATION_PERSON_ORDER_DOMAIN = "accusation-person-order";
