import type { ReactNode } from "react";

export function Card({ title, children, footer }: { title?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      {title && <h3 className="mb-3 text-base font-semibold text-slate-900">{title}</h3>}
      <div className="text-sm text-slate-700">{children}</div>
      {footer && <div className="mt-4 border-t border-slate-100 pt-3">{footer}</div>}
    </section>
  );
}
