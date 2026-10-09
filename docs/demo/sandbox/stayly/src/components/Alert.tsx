import type { ReactNode } from "react";

export function Alert({ tone = "info", children }: { tone?: "info" | "warning" | "error"; children: ReactNode }) {
  const tones = { info: "bg-sky-50 text-sky-900 border-sky-200", warning: "bg-amber-50 text-amber-900 border-amber-200", error: "bg-rose-50 text-rose-900 border-rose-200" };
  return <div role="alert" className={`rounded-lg border px-4 py-3 text-sm ${tones[tone]}`}>{children}</div>;
}
