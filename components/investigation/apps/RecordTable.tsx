import type { FinancialRecordLine, RecordLine } from "@/lib/game-session/app-actions";

function isFinancialLine(line: RecordLine | FinancialRecordLine): line is FinancialRecordLine {
  return "amountLabel" in line && line.amountLabel !== "";
}

/** Below `sm`, a real `<table>` forces either unreadably tiny columns or
 * horizontal scrolling to inspect a single record — neither is
 * acceptable for data the player actually needs to read (Step 6: don't
 * just shrink a table until it's unreadable). Rendered as stacked
 * key/value cards instead; the table itself is kept for `sm+`, where
 * there's enough width for columns to read naturally.
 *
 * `FinancialRecordLine`s (req. 6-7) get an extra amount/direction/
 * counterparty row — detected per-line via `isFinancialLine` rather than
 * a separate component, so `RecordTable` keeps working unchanged for the
 * phone/vehicle/search-warrant lines that don't carry those fields. */
export function RecordTable({ lines, emptyLabel }: { lines: (RecordLine | FinancialRecordLine)[]; emptyLabel: string }) {
  if (lines.length === 0) {
    return <p className="panel-sunken border-dashed p-3 text-sm text-muted">{emptyLabel}</p>;
  }
  return (
    <>
      <div className="flex flex-col gap-2 sm:hidden">
        {lines.map((line) => (
          <div key={line.id} className="panel-sunken flex flex-col gap-1 p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-data text-xs text-muted">{line.timeLabel}</span>
              <span className="font-semibold text-link">{line.typeLabel}</span>
            </div>
            <p className="text-foreground">{line.detail}</p>
            {isFinancialLine(line) && (
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-border pt-1 text-xs">
                <span className="font-data font-semibold text-foreground">{line.amountLabel}</span>
                <span className="text-muted">{line.directionLabel}</span>
                <span className="text-muted">{line.counterpartyLabel}</span>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="panel-sunken hidden overflow-x-auto sm:block">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="field-label !text-[10px] px-3 py-2 font-normal">Horodatage</th>
              <th className="field-label !text-[10px] px-3 py-2 font-normal">Type</th>
              <th className="field-label !text-[10px] px-3 py-2 font-normal">Détail</th>
              {lines.some(isFinancialLine) && (
                <>
                  <th className="field-label !text-[10px] px-3 py-2 font-normal">Montant</th>
                  <th className="field-label !text-[10px] px-3 py-2 font-normal">Sens</th>
                  <th className="field-label !text-[10px] px-3 py-2 font-normal">Contrepartie</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.id} className="border-t border-border align-top odd:bg-white/[0.015]">
                <td className="font-data whitespace-nowrap px-3 py-2 text-muted">{line.timeLabel}</td>
                <td className="whitespace-nowrap px-3 py-2 font-semibold text-link">{line.typeLabel}</td>
                <td className="px-3 py-2 text-foreground">{line.detail}</td>
                {lines.some(isFinancialLine) && (
                  <>
                    <td className="font-data whitespace-nowrap px-3 py-2 text-foreground">{isFinancialLine(line) ? line.amountLabel : ""}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-muted">{isFinancialLine(line) ? line.directionLabel : ""}</td>
                    <td className="px-3 py-2 text-muted">{isFinancialLine(line) ? line.counterpartyLabel : ""}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
