export function Divider({ label }: { label?: string }) {
  return label ? <div className="flex items-center gap-3 text-xs text-slate-500"><span className="h-px flex-1 bg-slate-200" />{label}<span className="h-px flex-1 bg-slate-200" /></div> : <hr className="border-slate-200" />;
}
