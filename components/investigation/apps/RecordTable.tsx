import type { RecordLine } from "@/lib/game-session/app-actions";

/** Below `sm`, a real `<table>` forces either unreadably tiny columns or
 * horizontal scrolling to inspect a single record — neither is
 * acceptable for data the player actually needs to read (Step 6: don't
 * just shrink a table until it's unreadable). Rendered as stacked
 * key/value cards instead; the table itself is kept for `sm+`, where
 * there's enough width for columns to read naturally. */
export function RecordTable({ lines, emptyLabel }: { lines: RecordLine[]; emptyLabel: string }) {
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
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.id} className="border-t border-border align-top odd:bg-white/[0.015]">
                <td className="font-data whitespace-nowrap px-3 py-2 text-muted">{line.timeLabel}</td>
                <td className="whitespace-nowrap px-3 py-2 font-semibold text-link">{line.typeLabel}</td>
                <td className="px-3 py-2 text-foreground">{line.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
