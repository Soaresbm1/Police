import { getCurrentGame } from "@/lib/game-session/current";
import { getDiscoveredRelationships, getPerson } from "@/lib/game-session/player-view";

const TYPE_LABEL: Record<string, string> = {
  family: "Famille",
  spouse: "Époux/se",
  partner: "Partenaire",
  ex_partner: "Ex-partenaire",
  friend: "Ami·e",
  colleague: "Collègue",
  boss: "Supérieur hiérarchique",
  employee: "Employé·e",
  rival: "Rival·e",
  creditor_debtor: "Créancier / débiteur",
  affair: "Liaison",
  conflict: "Conflit",
  neighbor: "Voisin·e",
  acquaintance: "Connaissance",
};

export default async function RelationsPage() {
  const game = await getCurrentGame();
  if (!game) return null;
  const relationships = getDiscoveredRelationships(game.truth, game.session);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Relations</h1>
        <p className="mt-1 text-sm text-muted">Comment les personnes impliquées sont-elles liées entre elles ?</p>
      </div>

      {relationships.length === 0 ? (
        <p className="rounded border border-border bg-surface p-5 text-sm text-muted">
          Aucun lien confirmé pour l&apos;instant. Interrogez les suspects et témoins, ou croisez des preuves
          mentionnant plusieurs personnes, pour faire apparaître leurs relations.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {relationships.map((rel) => {
            const from = getPerson(game.truth, rel.fromId);
            const to = getPerson(game.truth, rel.toId);
            return (
              <div key={rel.id} className="flex items-center justify-between rounded border border-border bg-surface p-3 text-sm">
                <span className="text-foreground">
                  {from?.firstName} {from?.lastName}
                </span>
                <span className="rounded bg-surface-raised px-2 py-1 text-xs text-accent-strong">{TYPE_LABEL[rel.type] ?? rel.type}</span>
                <span className="text-foreground">
                  {to?.firstName} {to?.lastName}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
