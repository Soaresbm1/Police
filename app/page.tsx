import Link from "next/link";
import { getCurrentGame } from "@/lib/game-session/current";
import { getBriefing } from "@/lib/game-session/player-view";
import { startNewCase } from "@/lib/game-session/actions";
import { formatGameTime } from "@/lib/game-engine/types/time";

export const dynamic = "force-dynamic";

const DIFFICULTIES = [
  { value: "recruit", label: "Recrue", description: "Assistance renforcée, peu de suspects." },
  { value: "investigator", label: "Enquêteur", description: "Expérience standard." },
  { value: "inspector", label: "Inspecteur", description: "Davantage de bruit, témoignages moins fiables." },
  { value: "expert", label: "Expert", description: "Presque aucune aide, preuves ambiguës." },
];

export default async function Home() {
  const game = await getCurrentGame();

  return (
    <div className="flex flex-1 flex-col bg-background">
      <header className="border-b border-border px-8 py-6">
        <p className="text-xs uppercase tracking-[0.2em] text-muted">Police cantonale — Division criminelle</p>
        <h1 className="mt-1 text-2xl font-semibold text-foreground">CASELINE</h1>
      </header>

      <main className="mx-auto grid w-full max-w-5xl flex-1 gap-6 px-8 py-10 md:grid-cols-2">
        {game && (
          <section className="md:col-span-2 rounded border border-accent/40 bg-accent/5 p-6">
            <h2 className="text-sm uppercase tracking-wide text-accent-strong">Affaire en cours</h2>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="font-data text-lg text-foreground">{game.session.seed}</p>
                <p className="text-sm text-muted">
                  {getBriefing(game.truth).discoveryDescription} — {formatGameTime(game.session.currentTime)}
                </p>
              </div>
              <Link
                href="/investigation/affaire"
                className="rounded bg-accent px-4 py-2 text-sm font-medium text-background hover:bg-accent-strong"
              >
                Reprendre l&apos;enquête
              </Link>
            </div>
          </section>
        )}

        <section className="rounded border border-border bg-surface p-6">
          <h2 className="text-sm uppercase tracking-wide text-muted">Nouvelle enquête</h2>
          <p className="mt-2 text-sm text-muted">
            Génère une nouvelle affaire d&apos;homicide entièrement procédurale : population, relations, mobile,
            preuves et témoignages sont simulés à partir d&apos;une seed unique.
          </p>
          <form action={startNewCase} className="mt-4 flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2">
              {DIFFICULTIES.map((d) => (
                <label
                  key={d.value}
                  className="flex cursor-pointer flex-col rounded border border-border-strong p-3 text-sm hover:border-accent has-[:checked]:border-accent has-[:checked]:bg-accent/10"
                >
                  <span className="flex items-center gap-2 font-medium text-foreground">
                    <input type="radio" name="difficulty" value={d.value} defaultChecked={d.value === "investigator"} />
                    {d.label}
                  </span>
                  <span className="mt-1 text-xs text-muted">{d.description}</span>
                </label>
              ))}
            </div>
            <button
              type="submit"
              className="mt-2 rounded bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90"
            >
              Générer l&apos;affaire
            </button>
          </form>
          {game && <p className="mt-3 text-xs text-muted">Démarrer une nouvelle affaire remplacera l&apos;enquête en cours.</p>}
        </section>

        <section className="rounded border border-border bg-surface p-6">
          <h2 className="text-sm uppercase tracking-wide text-muted">Progression</h2>
          <p className="mt-2 text-sm text-muted">
            Le mode carrière (grade, XP, taux de résolution) sera disponible avec la sauvegarde persistante — voir{" "}
            <span className="font-data">ROADMAP.md</span>.
          </p>
        </section>
      </main>
    </div>
  );
}
