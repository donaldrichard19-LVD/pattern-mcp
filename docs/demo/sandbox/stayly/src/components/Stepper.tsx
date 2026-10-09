export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return <ol className="flex items-center gap-3 text-sm">{steps.map((s, i) => <li key={s} className={`flex items-center gap-2 ${i <= current ? "text-teal-700" : "text-slate-400"}`}><span className="flex h-6 w-6 items-center justify-center rounded-full border text-xs">{i + 1}</span>{s}</li>)}</ol>;
}
