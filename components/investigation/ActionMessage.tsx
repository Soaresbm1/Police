import { clearMessageAction } from "@/lib/game-session/actions";

export function ActionMessage({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border bg-accent/10 px-6 py-2 text-sm text-accent-strong">
      <span>{message}</span>
      <form action={clearMessageAction}>
        <button type="submit" className="text-muted hover:text-foreground" aria-label="Fermer">
          ✕
        </button>
      </form>
    </div>
  );
}
