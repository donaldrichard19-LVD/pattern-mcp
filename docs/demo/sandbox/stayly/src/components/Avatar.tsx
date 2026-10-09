export function Avatar({ name, src, size = 36 }: { name: string; src?: string; size?: number }) {
  const initials = name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  return src ? <img src={src} alt={name} width={size} height={size} className="rounded-full object-cover" /> : <span style={{ width: size, height: size }} className="inline-flex items-center justify-center rounded-full bg-teal-100 text-xs font-semibold text-teal-800">{initials}</span>;
}
