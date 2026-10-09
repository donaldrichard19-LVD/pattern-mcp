import type { ReactNode } from "react";

export function Drawer({ open, side = "right", onClose, children }: { open: boolean; side?: "left" | "right"; onClose: () => void; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-slate-900/40" onClick={onClose}>
      <aside onClick={(e) => e.stopPropagation()} className={`absolute top-0 h-full w-80 bg-white p-5 shadow-xl ${side === "right" ? "right-0" : "left-0"}`}>{children}</aside>
    </div>
  );
}
