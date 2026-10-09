export function StarRating({ value, max = 5 }: { value: number; max?: number }) {
  return <span aria-label={`${value} out of ${max}`} className="text-amber-500">{"★".repeat(Math.round(value))}<span className="text-slate-300">{"★".repeat(max - Math.round(value))}</span></span>;
}
