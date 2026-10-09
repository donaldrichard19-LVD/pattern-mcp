export function Breadcrumbs({ items }: { items: { label: string; href?: string }[] }) {
  return <nav aria-label="Breadcrumb" className="flex gap-1 text-sm text-slate-500">{items.map((it, i) => <span key={i}>{it.href ? <a href={it.href} className="hover:text-slate-900">{it.label}</a> : <span className="text-slate-900">{it.label}</span>}{i < items.length - 1 && " / "}</span>)}</nav>;
}
