import Link from "next/link";
import type { PersonPublicView } from "@/lib/game-session/player-view";
import { CharacterPortrait } from "./CharacterPortrait";

export function PersonListCard({
  person,
  evidenceCount,
  generatedPortraitUrl,
}: {
  person: PersonPublicView;
  evidenceCount?: number;
  generatedPortraitUrl?: string | null;
}) {
  const fullName = `${person.firstName} ${person.lastName}`;
  return (
    <Link
      href={`/investigation/personnes/${person.id}`}
      className="panel group flex items-center gap-3 p-3 transition-colors hover:border-accent"
    >
      <CharacterPortrait seed={person.avatarSeed} name={fullName} size={48} generatedSrc={generatedPortraitUrl} />
      <div className="flex flex-1 flex-col gap-0.5">
        <span className="text-[15px] font-medium text-foreground group-hover:text-accent-strong">{fullName}</span>
        <span className="font-data text-xs text-muted">
          {person.age} ans — {person.profession}
        </span>
      </div>
      {typeof evidenceCount === "number" && evidenceCount > 0 && (
        <span className="border border-accent/40 bg-accent/10 px-2 py-1 text-[11px] font-semibold text-accent-strong">
          {evidenceCount} PRV
        </span>
      )}
    </Link>
  );
}
