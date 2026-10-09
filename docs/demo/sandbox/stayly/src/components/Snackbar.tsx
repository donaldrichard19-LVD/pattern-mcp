import { useEffect } from "react";

type Tone = "info" | "success" | "error";

export function Snackbar({ message, tone = "info", open, onClose, durationMs = 4000 }: { message: string; tone?: Tone; open: boolean; onClose: () => void; durationMs?: number }) {
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(onClose, durationMs);
    return () => clearTimeout(t);
  }, [open, durationMs, onClose]);
  if (!open) return null;
  const tones: Record<Tone, string> = { info: "bg-slate-900", success: "bg-emerald-700", error: "bg-rose-700" };
  return <div role="status" className={`fixed bottom-6 left-1/2 -translate-x-1/2 rounded-lg px-4 py-3 text-sm text-white shadow-lg ${tones[tone]}`}>{message}</div>;
}
