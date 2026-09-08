import { formatGameTime } from "@/lib/game-engine/types/time";
import { sendToLabAction, collectEvidenceAction } from "@/lib/game-session/actions";
import type { VisibleEvidence } from "@/lib/game-session/player-view";
import { RECORD_TYPE_LABEL } from "@/lib/game-session/labels";
import { EvidenceVisual } from "@/lib/art/evidence-renderers";
import { EvidenceInspectionTrigger } from "./EvidenceInspectionModal";

const RELIABILITY_COLOR: Record<string, string> = {
  reliable: "text-success",
  partial: "text-warning",
  ambiguous: "text-warning",
  contaminated: "text-danger",
  falsified: "text-danger",
};

const RELIABILITY_BORDER: Record<string, string> = {
  reliable: "border-l-success",
  partial: "border-l-warning",
  ambiguous: "border-l-warning",
  contaminated: "border-l-danger",
  falsified: "border-l-danger",
};

const STATUS_LABEL: Record<string, string> = {
  discovered: "Découverte",
  collected: "Prélevée",
  sent_to_lab: "Envoyée au labo",
  analyzed: "Analysée",
};

function evidenceCode(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return `EV-${(Math.abs(h) % 9000 + 1000).toString()}`;
}

export function EvidenceCard({ evidence }: { evidence: VisibleEvidence }) {
  return (
    <div className={`panel border-l-4 ${RELIABILITY_BORDER[evidence.reliability] ?? "border-l-border-strong"} flex flex-col gap-2 p-4`}>
      <EvidenceVisual evidence={evidence} className="aspect-[3/2] w-full" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="data-id">{evidenceCode(evidence.id)}</span>
        <span className="font-data text-xs uppercase tracking-wide text-muted">{RECORD_TYPE_LABEL[evidence.type]}</span>
      </div>
      <p className="text-sm text-foreground">{evidence.description}</p>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={RELIABILITY_COLOR[evidence.reliability] ?? "text-muted"}>{evidence.reliability}</span>
        <span className="border border-border-strong px-1.5 py-0.5 text-muted">{STATUS_LABEL[evidence.playerStatus]}</span>
        <span className="font-data ml-auto text-muted">{formatGameTime(evidence.timestamp)}</span>
      </div>
      <div className="flex flex-wrap gap-2 pt-1">
        <EvidenceInspectionTrigger evidence={evidence} />
        {evidence.playerStatus === "discovered" && (
          <form action={collectEvidenceAction.bind(null, evidence.id)}>
            <button type="submit" className="btn !px-3 !py-1 !text-[10px]">
              Prélever
            </button>
          </form>
        )}
        {evidence.requiresLabAnalysis && (evidence.playerStatus === "discovered" || evidence.playerStatus === "collected") && (
          <form action={sendToLabAction.bind(null, evidence.id)}>
            <button type="submit" className="btn btn-primary !px-3 !py-1 !text-[10px]">
              Envoyer au laboratoire ({evidence.requiresLabAnalysis})
            </button>
          </form>
        )}
        {evidence.playerStatus === "sent_to_lab" && <span className="text-xs text-warning">Analyse en cours…</span>}
      </div>
    </div>
  );
}
