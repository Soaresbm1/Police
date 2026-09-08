import Link from "next/link";
import { getCurrentGame } from "@/lib/game-session/current";
import { getSuspects } from "@/lib/game-session/player-view";
import { submitAccusationAction } from "@/lib/game-session/actions";
import { ACCOMPLICE_ROLE_LABEL, MOTIVE_LABEL, WEAPON_OPTIONS } from "@/lib/game-session/labels";
import { Soundscape } from "@/components/investigation/Soundscape";

const ACCOMPLICE_SLOTS = 3;

export default async function AccusationPage() {
  const game = await getCurrentGame();
  if (!game) return null;
  const suspects = getSuspects(game.truth);

  if (game.session.accusation) {
    return (
      <div className="panel mx-auto max-w-2xl p-6 text-sm text-muted">
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
      <Soundscape kind="accusation" />
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="field-label">Formulaire officiel</p>
          <h1 className="text-2xl font-bold uppercase tracking-wide text-foreground">Soumettre le dossier au procureur</h1>
          <p className="mt-1 text-sm text-muted">
            Cette décision est définitive : elle clôt l&apos;enquête et révèle la vérité de l&apos;affaire. Assurez-vous
            d&apos;avoir réuni suffisamment d&apos;éléments avant de continuer.
          </p>
        </div>
        <span className="stamp stamp-red shrink-0">Irréversible</span>
      </div>

      <form action={submitAccusationAction} className="panel flex flex-col gap-4 border-l-4 border-l-danger p-6">
        <div className="flex flex-col gap-1">
          <label className="field-label">Coupable présumé</label>
          <select name="culpritId" required className="border border-border-strong bg-surface-sunken px-3 py-2 text-sm text-foreground">
            <option value="">— sélectionner —</option>
            {suspects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.firstName} {s.lastName}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="field-label">Mobile</label>
          <select name="motiveType" required className="border border-border-strong bg-surface-sunken px-3 py-2 text-sm text-foreground">
            <option value="">— sélectionner —</option>
            {Object.entries(MOTIVE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="field-label">Méthode / arme</label>
          <select name="method" required className="border border-border-strong bg-surface-sunken px-3 py-2 text-sm text-foreground">
            <option value="">— sélectionner —</option>
            {WEAPON_OPTIONS.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <label className="field-label">Complice(s) suspecté(s) — facultatif</label>
          <p className="text-xs text-muted">
            Vous pouvez désigner personne, une seule personne, ou plusieurs. Une désignation erronée est pénalisée ; ne pas
            désigner un complice réel réduit la note mais ne fait jamais échouer une accusation correcte du coupable.
          </p>
          {Array.from({ length: ACCOMPLICE_SLOTS }).map((_, i) => (
            <div key={i} className="grid grid-cols-2 gap-2">
              <select name="accompliceId" className="border border-border-strong bg-surface-sunken px-3 py-2 text-sm text-foreground">
                <option value="">— aucun —</option>
                {suspects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.firstName} {s.lastName}
                  </option>
                ))}
              </select>
              <select name="accompliceRole" className="border border-border-strong bg-surface-sunken px-3 py-2 text-sm text-foreground">
                <option value="">— rôle inconnu —</option>
                {Object.entries(ACCOMPLICE_ROLE_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>

        <button type="submit" className="btn btn-danger mt-2">
          Soumettre l&apos;accusation
        </button>
      </form>
    </div>
  );
}
