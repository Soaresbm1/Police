import Link from "next/link";
import { getCurrentIdentity } from "@/lib/game-session/identity";
import { getStore } from "@/lib/game-session/persistence";
import { formatCaseNumber } from "@/lib/game-engine/world/city";

export const dynamic = "force-dynamic";

const GRADE_COLOR: Record<string, string> = {
  S: "text-accent-strong",
  A: "text-success",
  B: "text-link",
  C: "text-warning",
  D: "text-danger",
};

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString("fr-CH", { year: "numeric", month: "short", day: "numeric" });
}

export default async function DossiersPage() {
  const identity = await getCurrentIdentity();
  const entries = identity.authenticated ? await getStore().listCaseHistory(identity.userId) : [];

  return (
    <div className="min-h-dvh-screen mx-auto flex max-w-3xl flex-col gap-5 px-4 py-6 sm:px-6 sm:py-10">
      <div className="flex items-center justify-between">
        <div>
          <p className="field-label">Archives</p>
          <h1 className="text-2xl font-bold uppercase tracking-wide text-foreground">Dossiers classés</h1>
        </div>
        <Link href="/" className="btn">
          Retour au menu
        </Link>
      </div>

      {entries.length === 0 ? (
        <p className="panel p-5 text-sm text-muted">Aucune affaire classée pour l&apos;instant.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {entries.map((entry) => (
            <Link
              key={entry.id}
              href={`/dossiers/${entry.id}`}
              className="panel flex flex-wrap items-center justify-between gap-2 p-4 hover:border-accent"
            >
              <div>
                <p className="data-id">{formatCaseNumber(entry.seed)}</p>
                <p className="text-xs text-muted">{formatDate(entry.completedAt)} — {entry.difficulty}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className={`font-data text-2xl font-bold ${GRADE_COLOR[entry.score.grade]}`}>{entry.score.grade}</span>
                <span className={`stamp !py-0.5 !text-[9px] ${entry.score.culpritCorrect ? "stamp-blue" : "stamp-red"}`}>
                  {entry.score.culpritCorrect ? "Résolue" : "Non résolue"}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
