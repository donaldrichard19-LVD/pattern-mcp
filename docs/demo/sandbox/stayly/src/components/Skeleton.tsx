export function Skeleton({ lines = 3 }: { lines?: number }) {
  return <div className="space-y-2" aria-busy="true">{Array.from({ length: lines }).map((_, i) => <div key={i} className="h-4 animate-pulse rounded bg-slate-200" style={{ width: `${100 - i * 12}%` }} />)}</div>;
}
