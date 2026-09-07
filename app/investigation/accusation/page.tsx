import Link from "next/link";
import { getCurrentGame } from "@/lib/game-session/current";
import { getSuspects } from "@/lib/game-session/player-view";
import { submitAccusationAction } from "@/lib/game-session/actions";
import { MOTIVE_LABEL, WEAPON_OPTIONS } from "@/lib/game-session/labels";

export default async function AccusationPage() {
  const game = await getCurrentGame();
  if (!game) return null;
  const suspects = getSuspects(game.truth);

  if (game.session.accusation) {
    return (
      <div className="mx-auto max-w-2xl rounded border border-border bg-surface p-6 text-sm text-muted">
        Une accusation a déjà été soumise pour cette affaire.{" "}
        <Link href="/investigation/rapport" className="text-link underline">
          Consulter le rapport
        </Link>
        .
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Soumettre le dossier au procureur</h1>
        <p className="mt-1 text-sm text-muted">
          Cette décision est définitive : elle clôt l&apos;enquête et révèle la vérité de l&apos;affaire. Assurez-vous
          d&apos;avoir réuni suffisamment d&apos;éléments avant de continuer.
        </p>
      </div>

      <form action={submitAccusationAction} className="flex flex-col gap-4 rounded border border-danger/30 bg-surface p-6">
        <div className="flex flex-col gap-1">
          <label className="text-xs uppercase tracking-wide text-muted">Coupable présumé</label>
          <select name="culpritId" required className="rounded border border-border-strong bg-background px-3 py-2 text-sm text-foreground">
            <option value="">— sélectionner —</option>
            {suspects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.firstName} {s.lastName}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs uppercase tracking-wide text-muted">Mobile</label>
          <select name="motiveType" required className="rounded border border-border-strong bg-background px-3 py-2 text-sm text-foreground">
            <option value="">— sélectionner —</option>
            {Object.entries(MOTIVE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs uppercase tracking-wide text-muted">Méthode / arme</label>
          <select name="method" required className="rounded border border-border-strong bg-background px-3 py-2 text-sm text-foreground">
            <option value="">— sélectionner —</option>
            {WEAPON_OPTIONS.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </div>

        <button type="submit" className="mt-2 rounded bg-danger px-4 py-2 text-sm font-medium text-white hover:opacity-90">
          Soumettre l&apos;accusation
        </button>
      </form>
    </div>
  );
}
