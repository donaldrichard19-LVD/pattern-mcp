import type { ReactNode } from "react";

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center"><h3 className="text-base font-semibold text-slate-900">{title}</h3><p className="mt-1 text-sm text-slate-600">{body}</p>{action && <div className="mt-4">{action}</div>}</div>;
}
