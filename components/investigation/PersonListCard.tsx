import Link from "next/link";
import type { PersonPublicView } from "@/lib/game-session/player-view";
import { Avatar } from "./Avatar";

export function PersonListCard({ person, evidenceCount }: { person: PersonPublicView; evidenceCount?: number }) {
  const fullName = `${person.firstName} ${person.lastName}`;
  return (
    <Link
      href={`/investigation/personnes/${person.id}`}
      className="flex items-center gap-3 rounded border border-border bg-surface p-4 transition-colors hover:border-accent"
    >
      <Avatar seed={person.avatarSeed} name={fullName} />
      <div className="flex flex-1 flex-col gap-1">
        <span className="text-base font-medium text-foreground">{fullName}</span>
        <span className="text-sm text-muted">
          {person.age} ans — {person.profession}
        </span>
      </div>
      {typeof evidenceCount === "number" && evidenceCount > 0 && (
        <span className="rounded bg-accent/15 px-2 py-1 text-xs text-accent-strong">{evidenceCount} preuve(s)</span>
      )}
    </Link>
  );
}
