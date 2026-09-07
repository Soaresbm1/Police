import { getCurrentGame } from "@/lib/game-session/current";
import { getVisibleEvidence } from "@/lib/game-session/player-view";
import { EvidenceCard } from "@/components/investigation/EvidenceCard";
import type { EvidenceFamily } from "@/lib/game-engine/types/evidence";

const FAMILY_LABEL: Record<EvidenceFamily, string> = {
  physical: "Physiques",
  digital: "Numériques",
  video: "Vidéo",
  financial: "Financières",
  testimonial: "Témoignages",
};

const FAMILY_ORDER: EvidenceFamily[] = ["physical", "video", "digital", "financial", "testimonial"];

export default async function PreuvesPage() {
  const game = await getCurrentGame();
  if (!game) return null;
  const evidence = getVisibleEvidence(game.truth, game.session);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Preuves</h1>
        <p className="mt-1 text-sm text-muted">
          Que puis-je apprendre de ces preuves ? {evidence.length} élément(s) découvert(s).
        </p>
      </div>

      {evidence.length === 0 && (
        <p className="rounded border border-border bg-surface p-5 text-sm text-muted">
          Aucune preuve découverte pour l&apos;instant. Examinez la scène de crime et interrogez les suspects et
          témoins pour commencer à réunir des éléments.
        </p>
      )}

      {FAMILY_ORDER.map((family) => {
        const items = evidence.filter((e) => e.family === family);
        if (items.length === 0) return null;
        return (
          <section key={family}>
            <h2 className="mb-3 text-xs uppercase tracking-wide text-muted">
              {FAMILY_LABEL[family]} ({items.length})
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {items.map((ev) => (
                <EvidenceCard key={ev.id} evidence={ev} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
