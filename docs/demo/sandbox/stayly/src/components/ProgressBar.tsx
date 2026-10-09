export function ProgressBar({ value, label }: { value: number; label: string }) {
  return <div aria-label={label} className="h-2 w-full rounded-full bg-slate-200"><div className="h-2 rounded-full bg-teal-600" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} /></div>;
}
