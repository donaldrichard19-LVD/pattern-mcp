export function DataTable<T extends Record<string, string | number>>({ columns, rows }: { columns: { key: keyof T & string; label: string }[]; rows: T[] }) {
  return (
    <table className="w-full text-left text-sm">
      <thead><tr className="border-b border-slate-200 text-slate-500">{columns.map((c) => <th key={c.key} className="py-2 font-medium">{c.label}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i} className="border-b border-slate-100">{columns.map((c) => <td key={c.key} className="py-2">{r[c.key]}</td>)}</tr>)}</tbody>
    </table>
  );
}
