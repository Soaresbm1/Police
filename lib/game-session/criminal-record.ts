import type { Person } from "@/lib/game-engine/types/person";

export interface CriminalRecordEntry {
  yearsAgo: number;
  offense: string;
  outcome: string;
}

/**
 * The engine's CaseTruth has no notion of a criminal record — this is
 * flavor depth for the Casier judiciaire app, derived purely from a
 * person's existing, already-generated traits (never influences motive,
 * evidence, or solvability). It's a pure function of `person`, so it's
 * deterministic and stable for the life of the case without needing to be
 * stored anywhere.
 */
function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

const OFFENSES: { offense: string; outcome: string }[] = [
  { offense: "Conduite en état d'ivresse", outcome: "amende" },
  { offense: "Coups et blessures", outcome: "peine avec sursis" },
  { offense: "Vol", outcome: "peine avec sursis" },
  { offense: "Escroquerie", outcome: "amende" },
  { offense: "Détention de stupéfiants", outcome: "amende" },
  { offense: "Violation de domicile", outcome: "peine avec sursis" },
  { offense: "Menaces", outcome: "amende" },
  { offense: "Dommages à la propriété", outcome: "amende" },
];

export function getCriminalRecord(person: Person): CriminalRecordEntry[] {
  const hash = hashString(person.id);
  const riskScore =
    person.personality.aggressiveness * 0.4 +
    (1 - person.personality.honesty) * 0.3 +
    person.personality.impulsivity * 0.2 +
    (person.addictions.length > 0 ? 0.3 : 0);

  const roll = (hash % 1000) / 1000;
  if (roll > 1 - riskScore * 0.55) {
    const count = hash % 5 === 0 ? 2 : 1;
    const entries: CriminalRecordEntry[] = [];
    for (let i = 0; i < count; i++) {
      const offense = OFFENSES[(hash + i * 7) % OFFENSES.length];
      entries.push({ ...offense, yearsAgo: 1 + ((hash + i * 13) % 8) });
    }
    return entries.sort((a, b) => a.yearsAgo - b.yearsAgo);
  }
  return [];
}
