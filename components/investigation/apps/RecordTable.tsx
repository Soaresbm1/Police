import type { RecordLine } from "@/lib/game-session/app-actions";

export function RecordTable({ lines, emptyLabel }: { lines: RecordLine[]; emptyLabel: string }) {
  if (lines.length === 0) {
    return <p className="panel-sunken border-dashed p-3 text-sm text-muted">{emptyLabel}</p>;
  }
  return (
    <div className="panel-sunken overflow-x-auto">
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
  );
}
