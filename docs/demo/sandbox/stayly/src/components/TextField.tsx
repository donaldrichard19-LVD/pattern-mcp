import type { InputHTMLAttributes } from "react";

export function TextField({ label, error, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-slate-700">{label}</span>
      <input className={`w-full rounded-lg border px-3 py-2 ${error ? "border-rose-500" : "border-slate-300"}`} {...props} />
      {error && <span className="mt-1 block text-xs text-rose-600">{error}</span>}
    </label>
  );
}
