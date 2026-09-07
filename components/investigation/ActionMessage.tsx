import { clearMessageAction } from "@/lib/game-session/actions";

export function ActionMessage({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="fade-up flex items-center justify-between gap-3 border-b border-accent-dim bg-surface-raised px-4 py-2">
      <div className="flex items-center gap-2 text-sm">
        <span className="font-data text-[10px] uppercase tracking-[0.18em] text-accent-strong">Système ›</span>
        <span className="text-foreground">{message}</span>
      </div>
      <form action={clearMessageAction}>
        <button type="submit" className="font-data text-xs text-muted hover:text-foreground" aria-label="Fermer">
          [x]
        </button>
      </form>
    </div>
  );
}
