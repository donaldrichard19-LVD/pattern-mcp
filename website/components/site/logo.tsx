import { cn } from '@/lib/utils'

export function PatternMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" aria-hidden="true" className={cn('size-6', className)}>
      <rect x="6" y="10" width="26" height="12" rx="6" className="fill-primary" />
      <rect x="36" y="10" width="22" height="12" rx="6" className="fill-success" opacity=".85" />
      <rect x="6" y="26" width="22" height="12" rx="6" className="fill-warn" />
      <rect x="32" y="26" width="26" height="12" rx="6" className="fill-primary" opacity=".55" />
      <rect x="6" y="42" width="30" height="12" rx="6" className="fill-success" />
      <rect x="40" y="42" width="18" height="12" rx="6" className="fill-warn" opacity=".7" />
    </svg>
  )
}

export function PatternWordmark({ className }: { className?: string }) {
  return (
    <span className={cn('font-wordmark font-black leading-none tracking-[-0.035em]', className)}>Pattern</span>
  )
}

export function PatternLogoPill() {
  return (
    <div className="inline-flex items-center gap-3 md:gap-4" role="img" aria-label="Pattern">
      <PatternMark className="size-14 md:size-18" />
      <PatternWordmark className="text-5xl md:text-6xl" />
    </div>
  )
}
