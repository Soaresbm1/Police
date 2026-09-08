import { redirect } from "next/navigation";
import { getCurrentGame } from "@/lib/game-session/current";
import { getPerson } from "@/lib/game-session/player-view";
import { scoreAccusation } from "@/lib/game-session/scoring";
import { MOTIVE_LABEL } from "@/lib/game-session/labels";
import { formatDuration, formatGameTime } from "@/lib/game-engine/types/time";
import { formatCaseNumber } from "@/lib/game-engine/world/city";
import { TruthRevealSequence, type TruthRevealData } from "@/components/investigation/TruthRevealSequence";

export default async function RapportPage() {
  const game = await getCurrentGame();
  if (!game) return null;
  const { truth, session } = game;
  if (!session.accusation) redirect("/investigation/accusation");

  const score = scoreAccusation(truth, session, session.accusation);
  const accusedPerson = getPerson(truth, session.accusation.culpritId);
  const realCulprit = getPerson(truth, truth.culpritId);
  const realVictim = getPerson(truth, truth.victimId);

  const data: TruthRevealData = {
    caseRef: formatCaseNumber(session.seed),
    grade: score.grade,
    overallPercent: score.overallPercent,
    culpritCorrect: score.culpritCorrect,
    accusedName: `${accusedPerson?.firstName} ${accusedPerson?.lastName}`,
    motiveCorrect: score.motiveCorrect,
    methodCorrect: score.methodCorrect,
    stats: [
      {
        label: "Preuves importantes trouvées",
        value: `${score.importantEvidenceFound} / ${score.importantEvidenceTotal}`,
        good: score.importantEvidenceFound === score.importantEvidenceTotal,
      },
      {
        label: "Couverture de la chronologie",
        value: `${score.chronologyCoveragePercent}%`,
        good: score.chronologyCoveragePercent >= 60,
      },
      { label: "Interrogatoires menés", value: String(score.interrogationsCount) },
      { label: "Mandats accordés / demandés", value: `${score.mandatesGranted} / ${score.mandatesRequested}` },
      { label: "Mandats sans lien avec le coupable", value: String(score.mandatesWasted), good: score.mandatesWasted === 0 },
      { label: "Temps d'enquête", value: formatDuration(score.gameTimeSpentMinutes) },
    ],
    realVictimName: `${realVictim?.firstName} ${realVictim?.lastName}`,
    realCulpritName: `${realCulprit?.firstName} ${realCulprit?.lastName}`,
    motiveLabel: MOTIVE_LABEL[truth.motive.type],
    motiveDescription: truth.motive.description,
    method: truth.method,
    timeline: [...truth.timeline]
      .sort((a, b) => a.timestamp - b.timestamp)
      .map((event) => ({
        id: event.id,
        timeLabel: formatGameTime(event.timestamp),
        description: event.description,
        isCrimeEvent: event.isCrimeEvent,
      })),
  };

  return <TruthRevealSequence data={data} />;
}
