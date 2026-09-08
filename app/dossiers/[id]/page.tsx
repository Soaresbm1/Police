import { notFound } from "next/navigation";
import { generateCase } from "@/lib/game-engine/case-generator/case-truth";
import { getCurrentIdentity } from "@/lib/game-session/identity";
import { getStore } from "@/lib/game-session/persistence";
import { buildNarrativeReconstruction } from "@/lib/game-session/narrative-reconstruction";
import { formatCaseNumber } from "@/lib/game-engine/world/city";
import { TruthRevealSequence, type TruthRevealData } from "@/components/investigation/TruthRevealSequence";

export default async function DossierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const identity = await getCurrentIdentity();
  if (!identity.authenticated) notFound();

  const entry = await getStore().getCaseHistoryEntry(identity.userId, id);
  if (!entry) notFound();

  const truth = generateCase(entry.seed, { difficulty: entry.difficulty });
  const accusedPerson = truth.people.find((p) => p.id === entry.accusation.culpritId);
  const realCulprit = truth.people.find((p) => p.id === truth.culpritId)!;
  const realVictim = truth.people.find((p) => p.id === truth.victimId)!;
  const score = entry.score;

  // Case history predating this milestone won't carry the newer accomplice
  // score fields — default them rather than let a stale record crash the page.
  const accompliceTotal = score.accompliceTotal ?? 0;
  const accompliceWronglyAccused = score.accompliceWronglyAccused ?? 0;

  const data: TruthRevealData = {
    caseRef: formatCaseNumber(entry.seed),
    grade: score.grade,
    overallPercent: score.overallPercent,
    culpritCorrect: score.culpritCorrect,
    accusedName: accusedPerson ? `${accusedPerson.firstName} ${accusedPerson.lastName}` : "Inconnu",
    motiveCorrect: score.motiveCorrect,
    methodCorrect: score.methodCorrect,
    stats: [
      {
        label: "Preuves importantes trouvées",
        value: `${score.importantEvidenceFound} / ${score.importantEvidenceTotal}`,
        good: score.importantEvidenceFound === score.importantEvidenceTotal,
      },
      { label: "Couverture de la chronologie", value: `${score.chronologyCoveragePercent}%`, good: score.chronologyCoveragePercent >= 60 },
      { label: "Interrogatoires menés", value: String(score.interrogationsCount) },
      { label: "Mandats accordés / demandés", value: `${score.mandatesGranted} / ${score.mandatesRequested}` },
      { label: "Mandats sans lien avec le coupable", value: String(score.mandatesWasted), good: score.mandatesWasted === 0 },
      { label: "Temps d'enquête", value: `${score.gameTimeSpentMinutes} min` },
    ],
    realVictimName: `${realVictim.firstName} ${realVictim.lastName}`,
    realCulpritName: `${realCulprit.firstName} ${realCulprit.lastName}`,
    narrative: buildNarrativeReconstruction(truth),
    accompliceScore:
      accompliceTotal > 0 || accompliceWronglyAccused > 0
        ? {
            identified: score.accompliceIdentified ?? 0,
            total: accompliceTotal,
            roleCorrect: score.accompliceRoleCorrect ?? 0,
            wronglyAccused: accompliceWronglyAccused,
          }
        : null,
  };

  return <TruthRevealSequence data={data} />;
}
