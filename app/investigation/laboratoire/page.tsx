import { getCurrentGame } from "@/lib/game-session/current";
import { getVisibleEvidence } from "@/lib/game-session/player-view";
import { sendToLabAction } from "@/lib/game-session/actions";
import { formatDuration, formatGameTime } from "@/lib/game-engine/types/time";
import { formatCaseNumber } from "@/lib/game-engine/world/city";
import { DocumentSheet } from "@/components/investigation/DocumentSheet";

const ANALYSIS_LABEL: Record<string, string> = {
  fingerprint: "Empreintes digitales",
  dna: "ADN",
  ballistics: "Balistique",
  toxicology: "Toxicologie",
  digital_forensics: "Forensique numérique",
};

export default async function LaboratoirePage() {
  const game = await getCurrentGame();
  if (!game) return null;
  const { truth, session } = game;
  const evidence = getVisibleEvidence(truth, session);
  const evidenceById = new Map(evidence.map((ev) => [ev.id, ev]));

  const activeJobs = session.labQueue
    .filter((job) => evidenceById.get(job.evidenceId)?.playerStatus === "sent_to_lab")
    .sort((a, b) => a.readyAt - b.readyAt);

  const completed = evidence.filter((ev) => ev.playerStatus === "analyzed");

  const pending = evidence.filter(
    (ev) => ev.requiresLabAnalysis && (ev.playerStatus === "discovered" || ev.playerStatus === "collected"),
  );

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <div>
        <p className="field-label">Police scientifique</p>
        <h1 className="text-2xl font-bold uppercase tracking-wide text-foreground">Laboratoire</h1>
        <p className="mt-1 text-sm text-muted">Suivi des analyses en cours et des rapports disponibles.</p>
      </div>

      <section className="panel p-5">
        <p className="field-label mb-3">File d&apos;analyse ({activeJobs.length})</p>
        {activeJobs.length === 0 ? (
          <p className="text-sm text-muted">Aucune analyse en cours.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {activeJobs.map((job) => {
              const ev = evidenceById.get(job.evidenceId)!;
              const total = Math.max(1, job.readyAt - job.submittedAt);
              const elapsed = Math.min(total, Math.max(0, session.currentTime - job.submittedAt));
              const pct = Math.round((elapsed / total) * 100);
              const eta = Math.max(0, job.readyAt - session.currentTime);
              return (
                <div key={job.evidenceId} className="panel-sunken p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="data-id">{job.evidenceId.slice(0, 10).toUpperCase()}</span>
                    <span className="font-data text-[10px] uppercase tracking-wide text-warning">
                      {ANALYSIS_LABEL[job.analysisType] ?? job.analysisType}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-foreground">{ev.description}</p>
                  <div className="mt-2 flex items-center gap-3">
                    <div className="h-2 flex-1 border border-border-strong bg-surface">
                      <div className="h-full bg-warning transition-[width]" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="font-data w-24 shrink-0 text-right text-xs text-muted">
                      {eta > 0 ? `ETA ${formatDuration(eta)}` : "Terminé"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="panel p-5">
        <p className="field-label mb-3">En attente d&apos;envoi ({pending.length})</p>
        {pending.length === 0 ? (
          <p className="text-sm text-muted">Rien à envoyer pour l&apos;instant.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {pending.map((ev) => (
              <div key={ev.id} className="panel-sunken flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                <div>
                  <span className="font-data mr-2 text-xs uppercase tracking-wide text-muted">
                    {ANALYSIS_LABEL[ev.requiresLabAnalysis!] ?? ev.requiresLabAnalysis}
                  </span>
                  <span className="text-foreground">{ev.description}</span>
                </div>
                <form action={sendToLabAction.bind(null, ev.id)}>
                  <button type="submit" className="btn btn-primary">
                    Envoyer
                  </button>
                </form>
              </div>
            ))}
          </div>
        )}
      </section>

      <DocumentSheet title={`Rapports disponibles (${completed.length})`} caseRef={formatCaseNumber(session.seed)}>
        {completed.length === 0 ? (
          <p className="text-sm text-muted">Aucun rapport pour l&apos;instant.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {completed.map((ev) => (
              <div key={ev.id} className="panel-bracketed border border-success/40 bg-surface-sunken p-4">
                <div className="flex items-center justify-between">
                  <span className="stamp stamp-blue !py-0.5 !text-[9px]">Rapport</span>
                  <span className="font-data text-[10px] text-muted">{formatGameTime(ev.timestamp)}</span>
                </div>
                <p className="font-document mt-2 text-sm text-foreground">{ev.description}</p>
                <p className="mt-1 text-xs text-muted">Fiabilité : {ev.reliability}</p>
              </div>
            ))}
          </div>
        )}
      </DocumentSheet>
    </div>
  );
}
