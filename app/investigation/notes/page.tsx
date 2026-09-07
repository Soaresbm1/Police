import { getCurrentGame } from "@/lib/game-session/current";
import { saveNotesAction } from "@/lib/game-session/actions";

export default async function NotesPage() {
  const game = await getCurrentGame();
  if (!game) return null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold uppercase tracking-wide text-foreground">Notes</h1>
        <p className="mt-1 text-sm text-muted">Vos observations personnelles — sauvegardées avec votre enquête.</p>
      </div>
      <form action={saveNotesAction} className="flex flex-col gap-3">
        <textarea
          name="notes"
          defaultValue={game.session.notes}
          rows={16}
          placeholder="Écrivez vos hypothèses, questions en suspens, éléments à vérifier..."
          className="font-document w-full border border-border-strong bg-surface p-4 text-sm text-foreground focus:border-accent focus:outline-none"
        />
        <button type="submit" className="btn btn-primary self-start">
          Enregistrer
        </button>
      </form>
    </div>
  );
}
