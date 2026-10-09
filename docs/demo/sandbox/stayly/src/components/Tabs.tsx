export function Tabs({ tabs, active, onChange }: { tabs: { id: string; label: string }[]; active: string; onChange: (id: string) => void }) {
  return (
    <div role="tablist" className="flex gap-1 border-b border-slate-200">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={t.id === active} onClick={() => onChange(t.id)} className={`px-3 py-2 text-sm font-medium ${t.id === active ? "border-b-2 border-teal-600 text-teal-700" : "text-slate-500 hover:text-slate-800"}`}>{t.label}</button>
      ))}
    </div>
  );
}
