import type { ReactNode } from "react";
import { CITY } from "@/lib/game-engine/world/city";
import { PoliceEmblem } from "@/components/shared/PoliceEmblem";

/**
 * Shared header/footer wrapper for anything meant to read as a real police
 * document (autopsy, lab report, warrant, transcript, statement) — built
 * from the existing `.font-document`/`.panel-bracketed`/`.stamp`/`.data-id`
 * primitives already used ad hoc across these screens, so this is a
 * consistency layer, not a redesign of any screen that already works.
 */
export function DocumentSheet({
  title,
  caseRef,
  classification = "Confidentiel",
  pageLabel,
  children,
}: {
  title: string;
  caseRef: string;
  classification?: "Confidentiel" | "Interne" | "Pièce à conviction";
  pageLabel?: string;
  children: ReactNode;
}) {
  return (
    <section className="panel panel-bracketed p-5">
      <div className="panel-header -mx-5 -mt-5 mb-4 flex items-center gap-3">
        <PoliceEmblem size={22} className="shrink-0 text-accent-strong" />
        <div className="flex-1">
          <p className="font-data text-[9px] uppercase tracking-[0.14em] text-muted-dim">{CITY.policeDepartment}</p>
          <span className="field-label">{title}</span>
        </div>
        <span className="stamp stamp-blue !py-0.5 !text-[9px]">{classification}</span>
      </div>

      {children}

      <div className="hairline mt-4 flex items-center justify-between pt-2 text-[10px] text-muted-dim">
        <span className="data-id">{caseRef}</span>
        {pageLabel && <span className="font-data">{pageLabel}</span>}
      </div>
    </section>
  );
}
