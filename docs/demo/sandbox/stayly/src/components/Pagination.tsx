export function Pagination({ page, pageCount, onChange }: { page: number; pageCount: number; onChange: (p: number) => void }) {
  return (
    <nav className="flex items-center gap-2 text-sm" aria-label="Pagination">
      <button disabled={page <= 1} onClick={() => onChange(page - 1)} className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40">Prev</button>
      <span>Page {page} of {pageCount}</span>
      <button disabled={page >= pageCount} onClick={() => onChange(page + 1)} className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40">Next</button>
    </nav>
  );
}
