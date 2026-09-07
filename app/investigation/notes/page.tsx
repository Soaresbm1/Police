import { getCurrentGame } from "@/lib/game-session/current";
import { saveNotesAction } from "@/lib/game-session/actions";

export default async function NotesPage() {
  const game = await getCurrentGame();
  if (!game) return null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Notes</h1>
        <p className="mt-1 text-sm text-muted">Vos observations personnelles — sauvegardées avec votre enquête.</p>
      </div>
      <form action={saveNotesAction} className="flex flex-col gap-3">
        <textarea
          name="notes"
          defaultValue={game.session.notes}
          rows={16}
          placeholder="Écrivez vos hypothèses, questions en suspens, éléments à vérifier..."
          className="w-full rounded border border-border-strong bg-surface p-4 font-data text-sm text-foreground focus:border-accent focus:outline-none"
        />
        <button type="submit" className="self-start rounded bg-accent px-4 py-2 text-sm font-medium text-background hover:bg-accent-strong">
          Enregistrer
        </button>
      </form>
    </div>
  );
}
