import type { RecordLine } from "@/lib/game-session/app-actions";

export function RecordTable({ lines, emptyLabel }: { lines: RecordLine[]; emptyLabel: string }) {
  if (lines.length === 0) {
    return <p className="text-sm text-muted">{emptyLabel}</p>;
  }
  return (
    <table className="w-full text-left text-xs">
      <thead>
        <tr className="text-muted">
          <th className="pb-1 pr-3 font-normal">Horodatage</th>
          <th className="pb-1 pr-3 font-normal">Type</th>
          <th className="pb-1 font-normal">Détail</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line) => (
          <tr key={line.id} className="border-t border-border align-top">
            <td className="whitespace-nowrap py-1.5 pr-3 font-data text-muted">{line.timeLabel}</td>
            <td className="whitespace-nowrap py-1.5 pr-3 text-link">{line.typeLabel}</td>
            <td className="py-1.5 text-foreground">{line.detail}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
