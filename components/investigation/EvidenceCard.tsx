import { formatGameTime } from "@/lib/game-engine/types/time";
import { sendToLabAction, collectEvidenceAction } from "@/lib/game-session/actions";
import type { VisibleEvidence } from "@/lib/game-session/player-view";

const RELIABILITY_COLOR: Record<string, string> = {
  reliable: "text-success",
  partial: "text-warning",
  ambiguous: "text-warning",
  contaminated: "text-danger",
  falsified: "text-danger",
};

const STATUS_LABEL: Record<string, string> = {
  discovered: "Découverte",
  collected: "Prélevée",
  sent_to_lab: "Envoyée au labo",
  analyzed: "Analysée",
};

export function EvidenceCard({ evidence }: { evidence: VisibleEvidence }) {
  return (
    <div className="flex flex-col gap-2 rounded border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-data text-xs uppercase tracking-wide text-muted">{evidence.type}</span>
        <div className="flex items-center gap-2 text-xs">
          <span className={RELIABILITY_COLOR[evidence.reliability] ?? "text-muted"}>{evidence.reliability}</span>
          <span className="rounded bg-surface-raised px-2 py-0.5 text-muted">{STATUS_LABEL[evidence.playerStatus]}</span>
        </div>
      </div>
      <p className="text-sm text-foreground">{evidence.description}</p>
      <p className="font-data text-xs text-muted">Relevé vers {formatGameTime(evidence.timestamp)}</p>
      <div className="flex flex-wrap gap-2 pt-1">
        {evidence.playerStatus === "discovered" && (
          <form action={collectEvidenceAction.bind(null, evidence.id)}>
            <button type="submit" className="rounded border border-border-strong px-3 py-1 text-xs text-foreground hover:border-accent">
              Prélever
            </button>
          </form>
        )}
        {evidence.requiresLabAnalysis && (evidence.playerStatus === "discovered" || evidence.playerStatus === "collected") && (
          <form action={sendToLabAction.bind(null, evidence.id)}>
            <button type="submit" className="rounded bg-accent px-3 py-1 text-xs font-medium text-background hover:bg-accent-strong">
              Envoyer au laboratoire ({evidence.requiresLabAnalysis})
            </button>
          </form>
        )}
        {evidence.playerStatus === "sent_to_lab" && <span className="text-xs text-warning">Analyse en cours…</span>}
      </div>
    </div>
  );
}
