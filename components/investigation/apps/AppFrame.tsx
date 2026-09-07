import type { ReactNode } from "react";

const ACCENTS = {
  blue: { border: "border-link/40", text: "text-link", bg: "bg-link/10" },
  green: { border: "border-success/40", text: "text-success", bg: "bg-success/10" },
  amber: { border: "border-warning/40", text: "text-warning", bg: "bg-warning/10" },
  purple: { border: "border-[#a97fd9]/40", text: "text-[#a97fd9]", bg: "bg-[#a97fd9]/10" },
  red: { border: "border-danger/40", text: "text-danger", bg: "bg-danger/10" },
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
      <div className={`flex items-center justify-between rounded-t border-b ${colors.border} ${colors.bg} px-4 py-3`}>
        <div>
          <p className={`font-data text-[10px] uppercase tracking-[0.2em] ${colors.text}`}>{system}</p>
          <h1 className="text-xl font-semibold text-foreground">{title}</h1>
        </div>
        <span className={`font-data text-[10px] ${colors.text}`}>● EN LIGNE</span>
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </div>
  );
}
