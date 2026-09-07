import type { ReactNode } from "react";

const ACCENTS = {
  blue: { border: "border-link/50", text: "text-link", dot: "bg-link" },
  green: { border: "border-success/50", text: "text-success", dot: "bg-success" },
  amber: { border: "border-warning/50", text: "text-warning", dot: "bg-warning" },
  purple: { border: "border-[#a97fd9]/50", text: "text-[#a97fd9]", dot: "bg-[#a97fd9]" },
  red: { border: "border-danger/50", text: "text-danger", dot: "bg-danger" },
} as const;

export type AppAccent = keyof typeof ACCENTS;

export function AppFrame({
  title,
  system,
  accent,
  children,
}: {
  title: string;
  system: string;
  accent: AppAccent;
  children: ReactNode;
}) {
  const colors = ACCENTS[accent];
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div className={`panel-bracketed flex items-center justify-between border ${colors.border} bg-surface-sunken px-4 py-3`}>
        <div>
          <p className={`font-data text-[10px] uppercase tracking-[0.25em] ${colors.text}`}>{system}</p>
          <h1 className="text-xl font-bold uppercase tracking-wide text-foreground">{title}</h1>
        </div>
        <span className={`flex items-center gap-1.5 font-data text-[10px] uppercase tracking-wide ${colors.text}`}>
          <span className={`h-1.5 w-1.5 animate-pulse ${colors.dot}`} />
          En ligne
        </span>
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </div>
  );
}
