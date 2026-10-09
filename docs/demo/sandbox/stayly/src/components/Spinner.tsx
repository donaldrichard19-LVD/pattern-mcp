export function Spinner({ size = 20 }: { size?: number }) {
  return <span role="progressbar" aria-label="Loading" style={{ width: size, height: size }} className="inline-block animate-spin rounded-full border-2 border-slate-300 border-t-teal-600" />;
}
