type Tone = "neutral" | "success" | "warning";

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: string }) {
  const tones: Record<Tone, string> = {
    neutral: "bg-slate-100 text-slate-700",
    success: "bg-emerald-100 text-emerald-800",
    warning: "bg-amber-100 text-amber-800",
  };
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}
