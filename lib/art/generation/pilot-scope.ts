import type { CaseTruth } from "@/lib/game-engine/types/case";
import type { Person } from "@/lib/game-engine/types/person";

/**
 * The set of people worth spending a real generation call on: victim +
 * suspects (includes the culprit — this filter has no concept of guilt,
 * see `visual-manifest.ts`'s own guilt-safety guarantee) + witnesses,
 * excluding plain bystanders and red herrings. Deliberately NOT "every
 * person in the case" — that's what keeps a normal case's generation
 * count in the pilot's 5-10 range instead of dozens.
 *
 * The single source of truth for this filter — used by the dev inspector
 * (`/case-lab/art`), the read-only gameplay portrait lookup, and (once
 * approved) the automatic post-case-creation trigger — so cost estimates
 * and actual behavior can never silently drift apart across three copies
 * of the same rule.
 */
export function importantPeopleForPortraits(truth: CaseTruth): Person[] {
  return truth.people.filter(
    (p) => p.id === truth.victimId || truth.suspectIds.includes(p.id) || (p.roles.includes("witness") && !truth.redHerringPersonIds.includes(p.id)),
  );
}
